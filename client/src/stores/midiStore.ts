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
          currentFileId: state.currentFileId === id ? null : state.currentFileId,
        })),

      updateFile: (id, updates) =>
        set((state) => ({
          files: state.files.map((f) =>
            f.id === id ? { ...f, ...updates, lastModified: Date.now() } : f
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
          playback: { ...state.playback, speed: Math.max(0.1, Math.min(2, speed)) },
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
                  tracks: f.tracks.map((t, i) =>
                    i === trackIndex ? { ...t, enabled: !t.enabled } : t
                  ),
                }
              : f
          ),
        })),
    }),
    {
      name: 'piano-storage',
      partialize: (state) => ({
        files: state.files.map((f) => ({ ...f, rawData: undefined })), // Don't persist raw data
        currentFileId: state.currentFileId,
        selectedInputId: state.selectedInputId,
        selectedOutputId: state.selectedOutputId,
        settings: state.settings,
      }),
    }
  )
);

/** Get notes that should be visible at a given time */
export function getVisibleNotes(
  file: MidiFile,
  currentTime: number,
  lookahead: number = 3
): MidiNote[] {
  const notes: MidiNote[] = [];

  // Debug: log file info occasionally
  if (Math.random() < 0.005) {
    console.log('[getVisibleNotes] file tracks:', file.tracks.length, 'total notes:', file.tracks.reduce((sum, t) => sum + t.notes.length, 0));
    console.log('[getVisibleNotes] track enabled states:', file.tracks.map(t => ({ name: t.name, enabled: t.enabled, notes: t.notes.length })));
  }

  for (const track of file.tracks) {
    if (!track.enabled) continue;
    for (const note of track.notes) {
      const noteEnd = note.startTime + note.duration;
      if (noteEnd >= currentTime && note.startTime <= currentTime + lookahead) {
        notes.push(note);
      }
    }
  }

  // Debug: log result occasionally
  if (Math.random() < 0.005 && notes.length > 0) {
    console.log('[getVisibleNotes] Found', notes.length, 'visible notes, first note starts at:', notes[0].startTime.toFixed(3));
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
