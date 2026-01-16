/**
 * Playback Simulator - Simulate MIDI playback and note presses without real-time delays
 */

import {
  useMidiStore,
  getActiveNotesAtTime,
  getWaitModeNotes,
  WAIT_MODE_GRACE_PERIOD,
} from '../../stores/midiStore';
import type { MidiFile, MidiNote } from '../../types/midi';

export interface PlaybackSimulator {
  /** The MIDI file being simulated */
  file: MidiFile;

  /** Current simulated time in seconds */
  readonly currentTime: number;

  /** Whether wait mode is enabled */
  readonly waitMode: boolean;

  /** Whether playback is active */
  readonly isPlaying: boolean;

  /** Advance time by delta seconds */
  advanceTime(delta: number): void;

  /** Seek to specific time in seconds */
  seekTo(time: number): void;

  /** Simulate pressing a note (MIDI key down) */
  pressNote(noteNumber: number): void;

  /** Simulate releasing a note (MIDI key up) */
  releaseNote(noteNumber: number): void;

  /** Press multiple notes at once */
  pressNotes(noteNumbers: number[]): void;

  /** Get notes currently active in the MIDI file at current time */
  getActiveNotes(): MidiNote[];

  /** Get note numbers currently active */
  getActiveNoteNumbers(): number[];

  /** Get notes needed for wait mode (including grace period) */
  getWaitModeNotes(): MidiNote[];

  /** Get note numbers needed for wait mode */
  getWaitModeNoteNumbers(): number[];

  /** Check if all wait mode notes are satisfied */
  areAllWaitNotesSatisfied(): boolean;

  /** Get unsatisfied notes that are blocking wait mode */
  getUnsatisfiedNotes(): MidiNote[];

  /** Check if a specific note pitch is satisfied */
  isNoteSatisfied(noteNumber: number): boolean;

  /** Get the set of satisfied notes from the store */
  getSatisfiedNotes(): Map<number, Set<number>>;

  /** Start playback */
  play(): void;

  /** Pause playback */
  pause(): void;

  /** Stop playback and reset */
  stop(): void;

  /** Enable/disable wait mode */
  setWaitMode(enabled: boolean): void;

  /** Get full store state snapshot */
  getState(): ReturnType<typeof useMidiStore.getState>;

  /** Clear all satisfied wait notes */
  clearSatisfiedNotes(): void;

  /** Simulate a full note press sequence: press all active notes */
  pressAllActiveNotes(): void;

  /** Step through time, pressing required notes automatically */
  autoPlayStep(deltaTime: number): {
    newTime: number;
    notesPressed: number[];
    wouldBlock: boolean;
  };
}

/**
 * Create a playback simulator for a MIDI file
 */
export function createPlaybackSimulator(file: MidiFile): PlaybackSimulator {
  const store = useMidiStore;

  // Initialize store with the test file
  store.setState({
    files: [file],
    currentFileId: file.id,
    playback: {
      isPlaying: false,
      currentTime: 0,
      speed: 1,
      waitMode: false,
      activeNotes: new Set(),
      loopEnabled: false,
      loopStartMeasure: null,
      loopEndMeasure: null,
    },
    liveNotes: new Set(),
    // Index-based wait mode state
    waitModeSortedNotes: [],
    waitModeSatisfiedIndices: new Set(),
    waitModeReachedIndex: 0,
  });

  // Build the sorted note list for wait mode
  store.getState().buildWaitModeNoteList();

  return {
    file,

    get currentTime() {
      return store.getState().playback.currentTime;
    },

    get waitMode() {
      return store.getState().playback.waitMode;
    },

    get isPlaying() {
      return store.getState().playback.isPlaying;
    },

    advanceTime(delta: number) {
      const state = store.getState();
      const newTime = Math.min(
        state.playback.currentTime + delta,
        file.duration
      );
      store.getState().seek(newTime);

      // Advance the wait mode cursor (mimics playback loop behavior)
      store.getState().advanceWaitModeReached(newTime);
    },

    seekTo(time: number) {
      store.getState().seek(time);
      // Reset wait mode state on seek (mimics real playback behavior)
      store.getState().resetWaitModeState(time);
    },

    pressNote(noteNumber: number) {
      store.getState().setLiveNote(noteNumber, true);
      store.getState().addSatisfiedWaitNote(noteNumber);
    },

    releaseNote(noteNumber: number) {
      store.getState().setLiveNote(noteNumber, false);
    },

    pressNotes(noteNumbers: number[]) {
      for (const note of noteNumbers) {
        this.pressNote(note);
      }
    },

    getActiveNotes() {
      return getActiveNotesAtTime(file, this.currentTime);
    },

    getActiveNoteNumbers() {
      return this.getActiveNotes().map((n) => n.noteNumber);
    },

    getWaitModeNotes() {
      return getWaitModeNotes(file, this.currentTime);
    },

    getWaitModeNoteNumbers() {
      return this.getWaitModeNotes().map((n) => n.noteNumber);
    },

    areAllWaitNotesSatisfied() {
      return !store.getState().hasUnsatisfiedWaitNotes(this.currentTime);
    },

    getUnsatisfiedNotes() {
      const state = store.getState();
      const currentTime = state.playback.currentTime;
      const unsatisfied: MidiNote[] = [];
      for (let i = 0; i < state.waitModeReachedIndex; i++) {
        if (!state.waitModeSatisfiedIndices.has(i)) {
          const note = state.waitModeSortedNotes[i];
          // Only count notes that are still active (haven't ended yet)
          if (note.startTime + note.duration > currentTime) {
            unsatisfied.push(note);
          }
        }
      }
      return unsatisfied;
    },

    isNoteSatisfied(noteNumber: number) {
      const state = store.getState();
      // Check if any reached note with this pitch is unsatisfied
      for (let i = 0; i < state.waitModeReachedIndex; i++) {
        const note = state.waitModeSortedNotes[i];
        if (note.noteNumber === noteNumber && !state.waitModeSatisfiedIndices.has(i)) {
          return false;
        }
      }
      return true;
    },

    getSatisfiedNotes() {
      // Return a Map for backward compatibility with tests
      const state = store.getState();
      const result = new Map<number, Set<number>>();
      for (const idx of state.waitModeSatisfiedIndices) {
        const note = state.waitModeSortedNotes[idx];
        if (!result.has(note.noteNumber)) {
          result.set(note.noteNumber, new Set());
        }
        result.get(note.noteNumber)!.add(note.startTime);
      }
      return result;
    },

    play() {
      store.getState().play();
    },

    pause() {
      store.getState().pause();
    },

    stop() {
      store.getState().stop();
      store.getState().resetWaitModeState(0);
    },

    setWaitMode(enabled: boolean) {
      const state = store.getState();
      if (state.playback.waitMode !== enabled) {
        store.getState().toggleWaitMode();
      }
      // Rebuild note list when enabling wait mode
      if (enabled) {
        store.getState().buildWaitModeNoteList();
      }
    },

    getState() {
      return store.getState();
    },

    clearSatisfiedNotes() {
      store.getState().resetWaitModeState(store.getState().playback.currentTime);
    },

    pressAllActiveNotes() {
      const activeNotes = this.getActiveNoteNumbers();
      for (const note of activeNotes) {
        this.pressNote(note);
      }
    },

    autoPlayStep(deltaTime: number) {
      const activeNotesBefore = this.getActiveNoteNumbers();

      // Advance time
      this.advanceTime(deltaTime);

      const newTime = this.currentTime;
      const activeNotesAfter = this.getActiveNoteNumbers();

      // Find new notes that appeared
      const newNotes = activeNotesAfter.filter(
        (n) => !activeNotesBefore.includes(n)
      );

      // Press the new notes
      const notesPressed: number[] = [];
      for (const note of newNotes) {
        this.pressNote(note);
        notesPressed.push(note);
      }

      // Check if we would block (unsatisfied notes remaining)
      const wouldBlock = !this.areAllWaitNotesSatisfied();

      return { newTime, notesPressed, wouldBlock };
    },
  };
}

/**
 * Run a complete playthrough simulation, detecting any blocking points
 */
export function simulatePlaythrough(
  file: MidiFile,
  options?: {
    timeStep?: number;
    maxTime?: number;
    autoPress?: boolean;
  }
): {
  completed: boolean;
  blockingPoints: Array<{
    time: number;
    unsatisfiedNotes: MidiNote[];
  }>;
  totalTime: number;
} {
  const { timeStep = 0.1, maxTime = file.duration + 1, autoPress = true } =
    options ?? {};

  const sim = createPlaybackSimulator(file);
  sim.play();
  sim.setWaitMode(true);

  const blockingPoints: Array<{
    time: number;
    unsatisfiedNotes: MidiNote[];
  }> = [];

  let currentTime = 0;
  const seenBlockingTimes = new Set<string>();

  while (currentTime < maxTime && currentTime < file.duration) {
    sim.seekTo(currentTime);

    // Get active notes at this time
    const activeNotes = sim.getActiveNotes();

    if (activeNotes.length > 0) {
      if (autoPress) {
        // Try to press all active notes
        sim.pressAllActiveNotes();
      }

      // Check if still blocking
      const unsatisfied = sim.getUnsatisfiedNotes();
      if (unsatisfied.length > 0) {
        // Create a key for this blocking point to avoid duplicates
        const key = unsatisfied
          .map((n) => `${n.noteNumber}:${n.startTime.toFixed(3)}`)
          .sort()
          .join(',');

        if (!seenBlockingTimes.has(key)) {
          seenBlockingTimes.add(key);
          blockingPoints.push({
            time: currentTime,
            unsatisfiedNotes: [...unsatisfied],
          });
        }
      }
    }

    currentTime += timeStep;
  }

  return {
    completed: blockingPoints.length === 0,
    blockingPoints,
    totalTime: currentTime,
  };
}

export { WAIT_MODE_GRACE_PERIOD };
