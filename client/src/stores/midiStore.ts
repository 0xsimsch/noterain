import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  MidiFile,
  MidiDevice,
  PlaybackState,
  Settings,
  MidiNote,
} from '../types/midi';
import { DEFAULT_SETTINGS, PIANO_MIN_NOTE, PIANO_MAX_NOTE } from '../types/midi';

interface MidiStore {
  // MIDI Files
  files: MidiFile[];
  currentFileId: string | null;
  addFile: (file: MidiFile) => void;
  removeFile: (id: string) => void;
  updateFile: (id: string, updates: Partial<MidiFile>) => void;
  setCurrentFile: (id: string | null) => void;
  getCurrentFile: () => MidiFile | null;

  // MIDI Devices
  devices: MidiDevice[];
  selectedInputId: string | null;
  selectedOutputId: string | null;
  setDevices: (devices: MidiDevice[]) => void;
  selectInput: (id: string | null) => void;
  selectOutput: (id: string | null) => void;

  // Playback
  playback: PlaybackState;
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (time: number) => void;
  setSpeed: (speed: number) => void;
  toggleWaitMode: () => void;
  setActiveNotes: (notes: Set<number>) => void;
  addActiveNote: (note: number) => void;
  removeActiveNote: (note: number) => void;

  // Loop
  setLoopRange: (start: number | null, end: number | null) => void;
  toggleLoop: () => void;
  clearLoop: () => void;

  // Live input notes (from MIDI keyboard)
  liveNotes: Set<number>;
  setLiveNote: (note: number, active: boolean) => void;
  clearLiveNotes: () => void;

  // Index-based wait mode tracking - avoids all timing edge cases
  // Sorted list of all enabled notes for wait mode
  waitModeSortedNotes: MidiNote[];
  // Set of indices into waitModeSortedNotes that have been satisfied
  waitModeSatisfiedIndices: Set<number>;
  // Cursor: index of first note NOT yet reached (notes before this are "due")
  waitModeReachedIndex: number;
  // Build the sorted note list from enabled tracks
  buildWaitModeNoteList: () => void;
  // Reset wait mode state (on seek, stop, loop)
  resetWaitModeState: (seekTime?: number) => void;
  // Advance the reached cursor based on current time
  advanceWaitModeReached: (currentTime: number) => void;
  // Satisfy a note by pitch - finds earliest unsatisfied reached note
  addSatisfiedWaitNote: (noteNumber: number) => void;
  // Check if there are unsatisfied notes that are still active at given time
  hasUnsatisfiedWaitNotes: (currentTime?: number) => boolean;
  // Get count of unsatisfied notes still active at given time
  getUnsatisfiedWaitNoteCount: (currentTime?: number) => number;

  // Settings
  settings: Settings;
  updateSettings: (updates: Partial<Settings>) => void;
  resetSettings: () => void;

  // Track visibility
  toggleTrack: (fileId: string, trackIndex: number) => void;
  toggleTrackRenderOnly: (fileId: string, trackIndex: number) => void;
  toggleTrackPlayAudio: (fileId: string, trackIndex: number) => void;
}

export const useMidiStore = create<MidiStore>()(
  persist(
    (set, get) => ({
      // MIDI Files
      files: [],
      currentFileId: null,

      addFile: (file) =>
        set((state) => ({
          files: [...state.files.filter((f) => f.id !== file.id), file],
        })),

      removeFile: (id) =>
        set((state) => ({
          files: state.files.filter((f) => f.id !== id),
          currentFileId:
            state.currentFileId === id ? null : state.currentFileId,
        })),

      updateFile: (id, updates) =>
        set((state) => ({
          files: state.files.map((f) =>
            f.id === id ? { ...f, ...updates, lastModified: Date.now() } : f,
          ),
        })),

      setCurrentFile: (id) => set({ currentFileId: id }),

      getCurrentFile: () => {
        const state = get();
        return state.files.find((f) => f.id === state.currentFileId) || null;
      },

      // MIDI Devices
      devices: [],
      selectedInputId: null,
      selectedOutputId: null,

      setDevices: (devices) => set({ devices }),
      selectInput: (id) => set({ selectedInputId: id }),
      selectOutput: (id) => set({ selectedOutputId: id }),

      // Playback
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

      play: () => {
        const state = get();
        let currentTime = state.playback.currentTime;

        // If loop is active and current position is outside loop range, jump to loop start
        if (state.playback.loopEnabled &&
            state.playback.loopStartMeasure !== null &&
            state.playback.loopEndMeasure !== null) {
          const file = state.files.find((f) => f.id === state.currentFileId);
          if (file) {
            const loopStartTime = getMeasureTime(file, state.playback.loopStartMeasure);
            const loopEndTime = getMeasureTime(file, state.playback.loopEndMeasure + 1);
            if (currentTime < loopStartTime || currentTime >= loopEndTime) {
              currentTime = loopStartTime;
            }
          }
        }

        set({
          playback: { ...state.playback, isPlaying: true, currentTime },
        });
      },

      pause: () =>
        set((state) => ({
          playback: { ...state.playback, isPlaying: false },
        })),

      stop: () => {
        const state = get();
        // If loop is active, reset to loop start instead of beginning
        let resetTime = 0;
        if (state.playback.loopEnabled && state.playback.loopStartMeasure !== null) {
          const file = state.files.find((f) => f.id === state.currentFileId);
          if (file) {
            resetTime = getMeasureTime(file, state.playback.loopStartMeasure);
          }
        }
        set({
          playback: {
            ...state.playback,
            isPlaying: false,
            currentTime: resetTime,
            activeNotes: new Set(),
          },
        });
      },

      seek: (time) =>
        set((state) => ({
          playback: { ...state.playback, currentTime: Math.max(0, time) },
        })),

      setSpeed: (speed) =>
        set((state) => ({
          playback: {
            ...state.playback,
            speed: Math.max(0.1, Math.min(2, speed)),
          },
        })),

      toggleWaitMode: () =>
        set((state) => ({
          playback: { ...state.playback, waitMode: !state.playback.waitMode },
        })),

      setActiveNotes: (notes) =>
        set((state) => ({
          playback: { ...state.playback, activeNotes: notes },
        })),

      addActiveNote: (note) =>
        set((state) => {
          const newNotes = new Set(state.playback.activeNotes);
          newNotes.add(note);
          return { playback: { ...state.playback, activeNotes: newNotes } };
        }),

      removeActiveNote: (note) =>
        set((state) => {
          const newNotes = new Set(state.playback.activeNotes);
          newNotes.delete(note);
          return { playback: { ...state.playback, activeNotes: newNotes } };
        }),

      // Loop
      setLoopRange: (start, end) => {
        const state = get();
        // Ensure end is at least start + 1
        let adjustedEnd = end;
        if (start !== null && end !== null && end < start + 1) {
          adjustedEnd = start + 1;
        }
        // Seek to loop start when start measure changes
        let seekTime: number | null = null;
        if (start !== null && start !== state.playback.loopStartMeasure) {
          const file = state.files.find((f) => f.id === state.currentFileId);
          if (file) {
            seekTime = getMeasureTime(file, start);
          }
        }
        set({
          playback: {
            ...state.playback,
            loopStartMeasure: start,
            loopEndMeasure: adjustedEnd,
            // Auto-enable loop when both are set
            loopEnabled: start !== null && adjustedEnd !== null ? true : state.playback.loopEnabled,
            ...(seekTime !== null ? { currentTime: seekTime } : {}),
          },
        });
      },

      toggleLoop: () => {
        const state = get();
        const enabling = !state.playback.loopEnabled;

        // When enabling loop, default to current measure based on playback position
        let loopStartMeasure = state.playback.loopStartMeasure;
        let loopEndMeasure = state.playback.loopEndMeasure;

        if (enabling && loopStartMeasure === null) {
          const file = state.files.find((f) => f.id === state.currentFileId);
          if (file) {
            const currentMeasure = Math.floor(state.playback.currentTime / getSecondsPerMeasure(file));
            const maxMeasure = getMeasureCount(file) - 1;
            loopStartMeasure = currentMeasure;
            loopEndMeasure = Math.min(currentMeasure + 1, maxMeasure);
          } else {
            loopStartMeasure = 0;
            loopEndMeasure = 1;
          }
        }

        // Calculate seek time if enabling and we have a file
        let seekTime: number | null = null;
        if (enabling && loopStartMeasure !== null) {
          const file = state.files.find((f) => f.id === state.currentFileId);
          if (file) {
            seekTime = getMeasureTime(file, loopStartMeasure);
          }
        }

        set({
          playback: {
            ...state.playback,
            loopEnabled: enabling,
            // Reset measures to null when disabling so next enable uses current position
            loopStartMeasure: enabling ? loopStartMeasure : null,
            loopEndMeasure: enabling ? loopEndMeasure : null,
            ...(seekTime !== null ? { currentTime: seekTime } : {}),
          },
        });
      },

      clearLoop: () =>
        set((state) => ({
          playback: {
            ...state.playback,
            loopEnabled: false,
            loopStartMeasure: null,
            loopEndMeasure: null,
          },
        })),

      // Live notes
      liveNotes: new Set(),

      setLiveNote: (note, active) =>
        set((state) => {
          const newNotes = new Set(state.liveNotes);
          if (active) {
            newNotes.add(note);
          } else {
            newNotes.delete(note);
          }
          return { liveNotes: newNotes };
        }),

      clearLiveNotes: () => set({ liveNotes: new Set() }),

      // Index-based wait mode state
      waitModeSortedNotes: [],
      waitModeSatisfiedIndices: new Set(),
      waitModeReachedIndex: 0,

      // Build sorted note list from enabled tracks
      buildWaitModeNoteList: () => {
        const state = get();
        const file = state.files.find((f) => f.id === state.currentFileId);
        if (!file) {
          set({ waitModeSortedNotes: [], waitModeSatisfiedIndices: new Set(), waitModeReachedIndex: 0 });
          return;
        }

        const notes: MidiNote[] = [];
        for (const track of file.tracks) {
          if (track.enabled) {
            notes.push(...track.notes);
          }
        }
        // Sort by startTime - this is the only time comparison we do, and it's done once
        notes.sort((a, b) => a.startTime - b.startTime);

        // Find the starting cursor position based on current playback time
        const currentTime = state.playback.currentTime;
        let reachedIndex = 0;
        while (reachedIndex < notes.length && notes[reachedIndex].startTime <= currentTime) {
          reachedIndex++;
        }

        // Pre-satisfy only notes that started STRICTLY BEFORE currentTime
        // Notes starting exactly at currentTime should be played, not skipped
        const preSatisfied = new Set<number>();
        for (let i = 0; i < reachedIndex; i++) {
          if (notes[i].startTime < currentTime) {
            preSatisfied.add(i);
          }
        }

        set({
          waitModeSortedNotes: notes,
          waitModeSatisfiedIndices: preSatisfied,
          waitModeReachedIndex: reachedIndex,
        });
      },

      // Reset wait mode state (on seek, stop, loop)
      resetWaitModeState: (seekTime?: number) => {
        const state = get();
        const time = seekTime ?? 0;

        // Find the cursor position for the new time (notes at time ARE reached)
        let reachedIndex = 0;
        while (reachedIndex < state.waitModeSortedNotes.length &&
               state.waitModeSortedNotes[reachedIndex].startTime <= time) {
          reachedIndex++;
        }

        // Pre-satisfy only notes that started STRICTLY BEFORE seekTime
        // Notes starting exactly at seekTime should be played, not skipped
        const preSatisfied = new Set<number>();
        for (let i = 0; i < reachedIndex; i++) {
          if (state.waitModeSortedNotes[i].startTime < time) {
            preSatisfied.add(i);
          }
        }

        set({
          waitModeSatisfiedIndices: preSatisfied,
          waitModeReachedIndex: reachedIndex,
        });
      },

      // Advance the reached cursor as time progresses
      advanceWaitModeReached: (currentTime: number) =>
        set((state) => {
          let newIndex = state.waitModeReachedIndex;
          while (newIndex < state.waitModeSortedNotes.length &&
                 state.waitModeSortedNotes[newIndex].startTime <= currentTime) {
            newIndex++;
          }
          if (newIndex === state.waitModeReachedIndex) return state;
          return { waitModeReachedIndex: newIndex };
        }),

      // Satisfy a note - finds earliest unsatisfied reached note with matching pitch
      // NO TIME COMPARISONS - just integer index comparisons
      addSatisfiedWaitNote: (noteNumber) =>
        set((state) => {
          // Don't register keypresses while paused
          if (!state.playback.isPlaying) return state;

          // Look through reached notes (indices 0 to reachedIndex-1) for an unsatisfied match
          for (let i = 0; i < state.waitModeReachedIndex; i++) {
            const note = state.waitModeSortedNotes[i];
            if (note.noteNumber === noteNumber && !state.waitModeSatisfiedIndices.has(i)) {
              // Found an unsatisfied note with matching pitch - satisfy it
              const newSatisfied = new Set(state.waitModeSatisfiedIndices);
              newSatisfied.add(i);
              return { waitModeSatisfiedIndices: newSatisfied };
            }
          }

          // Also check notes slightly ahead (grace period for early hits)
          // Look up to grace period seconds ahead
          const currentTime = state.playback.currentTime;
          const gracePeriodSeconds = state.settings.waitModeGracePeriod / 1000;
          for (let i = state.waitModeReachedIndex; i < state.waitModeSortedNotes.length; i++) {
            const note = state.waitModeSortedNotes[i];
            // Stop if we're past the grace period
            if (note.startTime > currentTime + gracePeriodSeconds) break;
            if (note.noteNumber === noteNumber && !state.waitModeSatisfiedIndices.has(i)) {
              const newSatisfied = new Set(state.waitModeSatisfiedIndices);
              newSatisfied.add(i);
              return { waitModeSatisfiedIndices: newSatisfied };
            }
          }

          return state;
        }),

      // Check if there are unsatisfied notes that are still active (currently playing)
      // A note is active if: startTime <= currentTime < endTime
      hasUnsatisfiedWaitNotes: (time?: number) => {
        const state = get();
        const currentTime = time ?? state.playback.currentTime;
        for (let i = 0; i < state.waitModeReachedIndex; i++) {
          if (!state.waitModeSatisfiedIndices.has(i)) {
            const note = state.waitModeSortedNotes[i];
            // Only count if the note is still active (hasn't ended yet)
            if (note.startTime + note.duration > currentTime) {
              return true;
            }
          }
        }
        return false;
      },

      // Get count of unsatisfied notes that are still active
      getUnsatisfiedWaitNoteCount: (time?: number) => {
        const state = get();
        const currentTime = time ?? state.playback.currentTime;
        let count = 0;
        for (let i = 0; i < state.waitModeReachedIndex; i++) {
          if (!state.waitModeSatisfiedIndices.has(i)) {
            const note = state.waitModeSortedNotes[i];
            if (note.startTime + note.duration > currentTime) {
              count++;
            }
          }
        }
        return count;
      },

      // Settings
      settings: DEFAULT_SETTINGS,

      updateSettings: (updates) =>
        set((state) => ({
          settings: { ...state.settings, ...updates },
        })),

      resetSettings: () => set({ settings: DEFAULT_SETTINGS }),

      // Track visibility
      toggleTrack: (fileId, trackIndex) => {
        set((state) => ({
          files: state.files.map((f) =>
            f.id === fileId
              ? {
                  ...f,
                  tracks: f.tracks.map((t) =>
                    t.index === trackIndex ? { ...t, enabled: !t.enabled } : t,
                  ),
                }
              : f,
          ),
        }));
        // Rebuild wait mode note list when tracks change
        get().buildWaitModeNoteList();
      },

      toggleTrackRenderOnly: (fileId, trackIndex) =>
        set((state) => ({
          files: state.files.map((f) =>
            f.id === fileId
              ? {
                  ...f,
                  tracks: f.tracks.map((t) =>
                    t.index === trackIndex
                      ? { ...t, renderOnly: !t.renderOnly }
                      : t,
                  ),
                }
              : f,
          ),
        })),

      toggleTrackPlayAudio: (fileId, trackIndex) =>
        set((state) => ({
          files: state.files.map((f) =>
            f.id === fileId
              ? {
                  ...f,
                  tracks: f.tracks.map((t) =>
                    t.index === trackIndex
                      ? { ...t, playAudio: !t.playAudio }
                      : t,
                  ),
                }
              : f,
          ),
        })),
    }),
    {
      name: 'piano-storage',
      partialize: (state) => ({
        // Don't persist files - they contain too much note data and exceed localStorage quota
        selectedInputId: state.selectedInputId,
        selectedOutputId: state.selectedOutputId,
        settings: state.settings,
      }),
    },
  ),
);

/** Get notes that should be visible at a given time */
export function getVisibleNotes(
  file: MidiFile,
  currentTime: number,
  lookahead: number = 3,
): MidiNote[] {
  const notes: MidiNote[] = [];

  for (const track of file.tracks) {
    if (!track.enabled && !track.renderOnly) continue;
    for (const note of track.notes) {
      const noteEnd = note.startTime + note.duration;
      if (noteEnd >= currentTime && note.startTime <= currentTime + lookahead) {
        notes.push(note);
      }
    }
  }

  return notes;
}

/** Create a sorted index of all notes for efficient lookup, with max duration */
export function createSortedNotesIndex(file: MidiFile): { notes: MidiNote[]; maxDuration: number } {
  const notes: MidiNote[] = [];
  let maxDuration = 0;
  for (const track of file.tracks) {
    for (const note of track.notes) {
      notes.push(note);
      if (note.duration > maxDuration) {
        maxDuration = note.duration;
      }
    }
  }
  // Sort by startTime for binary search
  notes.sort((a, b) => a.startTime - b.startTime);
  return { notes, maxDuration };
}

/** Binary search to find the first note with startTime >= target */
function binarySearchByStartTime(notes: MidiNote[], targetTime: number): number {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (notes[mid].startTime < targetTime) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

/** Reusable buffer for getVisibleNotesFast to avoid per-frame allocation */
const _visibleNotesBuffer: MidiNote[] = [];

/** Get visible notes using binary search - O(log n + k) where k = notes in time window */
export function getVisibleNotesFast(
  sortedNotes: MidiNote[],
  maxDuration: number,
  currentTime: number,
  lookahead: number,
  enabledTracks: Set<number>,
): MidiNote[] {
  if (sortedNotes.length === 0) return _visibleNotesBuffer.length = 0, _visibleNotesBuffer;

  _visibleNotesBuffer.length = 0;
  const windowStart = currentTime - maxDuration; // Notes that started this long ago might still be playing
  const windowEnd = currentTime + lookahead;

  // Find first note that could possibly be visible (started after windowStart)
  const startIdx = binarySearchByStartTime(sortedNotes, windowStart);

  // Iterate until notes start after our lookahead window
  for (let i = startIdx; i < sortedNotes.length; i++) {
    const note = sortedNotes[i];
    // Stop when notes start after our window
    if (note.startTime > windowEnd) break;
    // Check if note is still visible (hasn't ended yet)
    const noteEnd = note.startTime + note.duration;
    if (noteEnd >= currentTime && enabledTracks.has(note.track)) {
      _visibleNotesBuffer.push(note);
    }
  }

  return _visibleNotesBuffer;
}

/** Get notes that are currently playing */
export function getActiveNotesAtTime(file: MidiFile, time: number): MidiNote[] {
  const notes: MidiNote[] = [];
  for (const track of file.tracks) {
    if (!track.enabled) continue;
    for (const note of track.notes) {
      if (note.startTime <= time && note.startTime + note.duration > time) {
        notes.push(note);
      }
    }
  }
  return notes;
}

/** Grace period in seconds for early note hits in wait mode */
export const WAIT_MODE_GRACE_PERIOD = 0.4;

/** Get notes that should be considered for wait mode (including upcoming notes within grace period) */
export function getWaitModeNotes(file: MidiFile, time: number, gracePeriodMs?: number): MidiNote[] {
  const gracePeriod = gracePeriodMs !== undefined ? gracePeriodMs / 1000 : WAIT_MODE_GRACE_PERIOD;
  const notes: MidiNote[] = [];
  for (const track of file.tracks) {
    if (!track.enabled) continue;
    for (const note of track.notes) {
      // Include notes that are currently playing OR about to start within grace period
      const noteEnd = note.startTime + note.duration;
      if (note.startTime <= time + gracePeriod && noteEnd > time) {
        notes.push(note);
      }
    }
  }
  return notes;
}

/**
 * Normalize unusual MIDI time signatures to standard notation.
 * Many MIDI files have incorrectly encoded denominators.
 */
function normalizeTimeSignature(
  numerator: number,
  denominator: number,
): { numerator: number; denominator: number } {
  let normNum = numerator;
  let normDenom = denominator;

  // Fix x/16 which is almost always an encoding error
  if (normDenom === 16) {
    if (normNum % 3 === 0 && normNum >= 6) {
      normDenom = 8;
    } else {
      normDenom = 4;
    }
  }

  // Fix very large denominators
  while (normDenom > 16) {
    if (normNum % 2 === 0 && normNum > 1) {
      normNum = normNum / 2;
    }
    normDenom = normDenom / 2;
  }

  if (normDenom === 16) {
    if (normNum % 3 === 0 && normNum >= 6) {
      normDenom = 8;
    } else {
      normDenom = 4;
    }
  }

  const validDenominators = [1, 2, 4, 8];
  if (!validDenominators.includes(normDenom)) {
    normDenom = validDenominators.reduce((prev, curr) =>
      Math.abs(curr - normDenom) < Math.abs(prev - normDenom) ? curr : prev
    );
  }

  normNum = Math.max(1, Math.round(normNum));
  return { numerator: normNum, denominator: normDenom };
}

/** Get seconds per measure for a MIDI file */
export function getSecondsPerMeasure(file: MidiFile): number {
  const bpm = file.tempos.length > 0 ? file.tempos[0].bpm : 120;
  const rawTimeSignature = file.timeSignature ?? { numerator: 4, denominator: 4 };
  const normalized = normalizeTimeSignature(rawTimeSignature.numerator, rawTimeSignature.denominator);

  const secondsPerQuarterNote = 60 / bpm;
  const secondsPerBeat = secondsPerQuarterNote * (4 / normalized.denominator);
  return secondsPerBeat * normalized.numerator;
}

/** Get the time in seconds for the start of a measure */
export function getMeasureTime(file: MidiFile, measureIndex: number): number {
  return measureIndex * getSecondsPerMeasure(file);
}

/** Get total number of measures in a file */
export function getMeasureCount(file: MidiFile): number {
  return Math.ceil(file.duration / getSecondsPerMeasure(file));
}

/** Calculate the min/max note range from enabled tracks with optional padding */
export function calculateNoteRange(
  file: MidiFile | null,
  padding: number = 2
): { minNote: number; maxNote: number } {
  // Default to full 88-key range when no file
  if (!file) {
    return { minNote: PIANO_MIN_NOTE, maxNote: PIANO_MAX_NOTE };
  }

  let minNote = Infinity;
  let maxNote = -Infinity;

  for (const track of file.tracks) {
    // Only consider enabled tracks
    if (!track.enabled) continue;

    for (const note of track.notes) {
      if (note.noteNumber < minNote) minNote = note.noteNumber;
      if (note.noteNumber > maxNote) maxNote = note.noteNumber;
    }
  }

  // If no notes found in enabled tracks, return full range
  if (minNote === Infinity || maxNote === -Infinity) {
    return { minNote: PIANO_MIN_NOTE, maxNote: PIANO_MAX_NOTE };
  }

  // Apply padding, clamped to piano range
  return {
    minNote: Math.max(PIANO_MIN_NOTE, minNote - padding),
    maxNote: Math.min(PIANO_MAX_NOTE, maxNote + padding),
  };
}
