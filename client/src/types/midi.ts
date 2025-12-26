/** A single MIDI note with timing and velocity */
export interface MidiNote {
  /** MIDI note number (0-127, middle C = 60) */
  noteNumber: number;
  /** Start time in seconds */
  startTime: number;
  /** Duration in seconds */
  duration: number;
  /** Velocity (0-127) */
  velocity: number;
  /** Track index this note belongs to */
  track: number;
  /** Channel (0-15) */
  channel: number;
}

/** A MIDI track containing notes and metadata */
export interface MidiTrack {
  /** Track index */
  index: number;
  /** Track name if available */
  name: string;
  /** Instrument name or program number */
  instrument: string;
  /** All notes in this track */
  notes: MidiNote[];
  /** Whether this track is currently visible/enabled */
  enabled: boolean;
  /** Color for visualization */
  color: string;
}

/** Parsed MIDI file representation */
export interface MidiFile {
  /** Unique identifier for this file */
  id: string;
  /** File name */
  name: string;
  /** Duration in seconds */
  duration: number;
  /** Ticks per quarter note (PPQ) */
  ticksPerBeat: number;
  /** Tempo in BPM (may change throughout song) */
  tempos: TempoChange[];
  /** Time signature */
  timeSignature: TimeSignature;
  /** All tracks */
  tracks: MidiTrack[];
  /** Raw MIDI data for export */
  rawData?: ArrayBuffer;
  /** When this file was last modified */
  lastModified: number;
}

/** Tempo change event */
export interface TempoChange {
  /** Time in seconds when tempo changes */
  time: number;
  /** New tempo in BPM */
  bpm: number;
}

/** Time signature */
export interface TimeSignature {
  numerator: number;
  denominator: number;
}

/** MIDI input event from hardware keyboard */
export interface MidiInputEvent {
  type: 'noteon' | 'noteoff';
  noteNumber: number;
  velocity: number;
  channel: number;
  timestamp: number;
}

/** Connected MIDI device */
export interface MidiDevice {
  id: string;
  name: string;
  manufacturer: string;
  type: 'input' | 'output';
  connected: boolean;
}

/** Playback state */
export interface PlaybackState {
  /** Whether currently playing */
  isPlaying: boolean;
  /** Current position in seconds */
  currentTime: number;
  /** Playback speed multiplier (1 = normal) */
  speed: number;
  /** Whether to wait for correct note input */
  waitMode: boolean;
  /** Currently active notes (for highlighting) */
  activeNotes: Set<number>;
}

/** App settings */
export interface Settings {
  /** Master volume (0-1) */
  volume: number;
  /** Whether audio playback is enabled */
  audioEnabled: boolean;
  /** Left hand color */
  leftHandColor: string;
  /** Right hand color */
  rightHandColor: string;
  /** Show sheet music view */
  showSheetMusic: boolean;
  /** Show falling notes view */
  showFallingNotes: boolean;
  /** Metronome enabled */
  metronomeEnabled: boolean;
  /** Notes scroll speed (affects how far ahead notes appear) */
  scrollSpeed: number;
}

/** Default settings */
export const DEFAULT_SETTINGS: Settings = {
  volume: 0.8,
  audioEnabled: true,
  leftHandColor: '#3b82f6', // blue
  rightHandColor: '#22c55e', // green
  showSheetMusic: false,
  showFallingNotes: true,
  metronomeEnabled: false,
  scrollSpeed: 1,
};

/** Note name utilities */
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export function getNoteNameFromNumber(noteNumber: number): string {
  const octave = Math.floor(noteNumber / 12) - 1;
  const noteName = NOTE_NAMES[noteNumber % 12];
  return `${noteName}${octave}`;
}

export function isBlackKey(noteNumber: number): boolean {
  const note = noteNumber % 12;
  return [1, 3, 6, 8, 10].includes(note);
}

/** Standard 88-key piano range */
export const PIANO_MIN_NOTE = 21; // A0
export const PIANO_MAX_NOTE = 108; // C8
export const PIANO_KEY_COUNT = PIANO_MAX_NOTE - PIANO_MIN_NOTE + 1;
