import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  MidiFile,
  MidiDevice,
  PlaybackState,
  Settings,
  MidiNote,
} from '../types/midi';
import { DEFAULT_SETTINGS } from '../types/midi';

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

  // Live input notes (from MIDI keyboard)
  liveNotes: Set<number>;
  setLiveNote: (note: number, active: boolean) => void;
  clearLiveNotes: () => void;

  // Satisfied notes for wait mode (notes that have been hit at least once)
  satisfiedWaitNotes: Set<number>;
  addSatisfiedWaitNote: (note: number) => void;
  clearSatisfiedWaitNotes: () => void;
  pruneStatisfiedWaitNotes: (requiredNotes: number[]) => void;

  // Settings
  settings: Settings;
  updateSettings: (updates: Partial<Settings>) => void;
  resetSettings: () => void;

  // Track visibility
  toggleTrack: (fileId: string, trackIndex: number) => void;
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
      },

      play: () =>
        set((state) => ({
          playback: { ...state.playback, isPlaying: true },
        })),

      pause: () =>
        set((state) => ({
          playback: { ...state.playback, isPlaying: false },
        })),

      stop: () =>
        set((state) => ({
          playback: {
            ...state.playback,
            isPlaying: false,
            currentTime: 0,
            activeNotes: new Set(),
          },
        })),

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

      // Satisfied wait notes
      satisfiedWaitNotes: new Set(),

      addSatisfiedWaitNote: (note) =>
        set((state) => {
          const newNotes = new Set(state.satisfiedWaitNotes);
          newNotes.add(note);
          return { satisfiedWaitNotes: newNotes };
        }),

      clearSatisfiedWaitNotes: () => set({ satisfiedWaitNotes: new Set() }),

      // Remove notes from satisfied set that are no longer required
      pruneStatisfiedWaitNotes: (requiredNotes: number[]) =>
        set((state) => {
          const required = new Set(requiredNotes);
          const pruned = new Set(
            [...state.satisfiedWaitNotes].filter((note) => required.has(note)),
          );
          return { satisfiedWaitNotes: pruned };
        }),

      // Settings
      settings: DEFAULT_SETTINGS,

      updateSettings: (updates) =>
        set((state) => ({
          settings: { ...state.settings, ...updates },
        })),

      resetSettings: () => set({ settings: DEFAULT_SETTINGS }),

      // Track visibility
      toggleTrack: (fileId, trackIndex) =>
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
    if (!track.enabled) continue;
    for (const note of track.notes) {
      const noteEnd = note.startTime + note.duration;
      if (noteEnd >= currentTime && note.startTime <= currentTime + lookahead) {
        notes.push(note);
      }
    }
  }

  return notes;
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
export const WAIT_MODE_GRACE_PERIOD = 0.15;

/** Get notes that should be considered for wait mode (including upcoming notes within grace period) */
export function getWaitModeNotes(file: MidiFile, time: number): MidiNote[] {
  const notes: MidiNote[] = [];
  for (const track of file.tracks) {
    if (!track.enabled) continue;
    for (const note of track.notes) {
      // Include notes that are currently playing OR about to start within grace period
      const noteEnd = note.startTime + note.duration;
      if (note.startTime <= time + WAIT_MODE_GRACE_PERIOD && noteEnd > time) {
        notes.push(note);
      }
    }
  }
  return notes;
}
