/**
 * MIDI Test Fixtures - Create test MIDI files programmatically or load from disk
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseMidiFile } from '../../lib/midi/parser';
import type { MidiFile, MidiTrack, MidiNote } from '../../types/midi';

/** Options for creating a test MIDI file */
export interface TestMidiFileOptions {
  id?: string;
  name?: string;
  notes: Array<{
    noteNumber: number;
    startTime: number;
    duration: number;
    velocity?: number;
    track?: number;
  }>;
  bpm?: number;
  timeSignature?: { numerator: number; denominator: number };
}

/**
 * Create a simple test MIDI file with specified notes
 */
export function createTestMidiFile(options: TestMidiFileOptions): MidiFile {
  const {
    id = `test-${Date.now()}`,
    name = 'Test Song',
    notes,
    bpm = 120,
    timeSignature = { numerator: 4, denominator: 4 },
  } = options;

  // Group notes by track
  const trackMap = new Map<number, MidiNote[]>();
  for (const note of notes) {
    const trackIndex = note.track ?? 0;
    if (!trackMap.has(trackIndex)) {
      trackMap.set(trackIndex, []);
    }
    trackMap.get(trackIndex)!.push({
      noteNumber: note.noteNumber,
      startTime: note.startTime,
      duration: note.duration,
      velocity: note.velocity ?? 100,
      track: trackIndex,
      channel: 0,
    });
  }

  const tracks: MidiTrack[] = Array.from(trackMap.entries()).map(
    ([index, trackNotes]) => ({
      index,
      name: `Track ${index + 1}`,
      instrument: 'Piano',
      notes: trackNotes.sort((a, b) => a.startTime - b.startTime),
      enabled: true,
      renderOnly: false,
      playAudio: true,
      color: '#3b82f6',
    })
  );

  const duration = notes.length > 0
    ? Math.max(...notes.map((n) => n.startTime + n.duration))
    : 0;

  return {
    id,
    name,
    duration,
    ticksPerBeat: 480,
    tempos: [{ time: 0, bpm }],
    timeSignature,
    keySignature: { key: 0, scale: 0 },
    tracks,
    lastModified: Date.now(),
  };
}

/**
 * Create a simple C major scale (C4 to C5)
 */
export function createScaleFixture(options?: {
  startTime?: number;
  noteDuration?: number;
  noteGap?: number;
}): MidiFile {
  const { startTime = 0, noteDuration = 0.5, noteGap = 0 } = options ?? {};
  const scaleNotes = [60, 62, 64, 65, 67, 69, 71, 72]; // C4 to C5

  return createTestMidiFile({
    name: 'C Major Scale',
    notes: scaleNotes.map((noteNumber, i) => ({
      noteNumber,
      startTime: startTime + i * (noteDuration + noteGap),
      duration: noteDuration,
    })),
  });
}

/**
 * Create a chord (multiple simultaneous notes)
 */
export function createChordFixture(options?: {
  noteNumbers?: number[];
  startTime?: number;
  duration?: number;
}): MidiFile {
  const {
    noteNumbers = [60, 64, 67], // C major chord
    startTime = 0,
    duration = 1,
  } = options ?? {};

  return createTestMidiFile({
    name: 'Chord Test',
    notes: noteNumbers.map((noteNumber) => ({
      noteNumber,
      startTime,
      duration,
    })),
  });
}

/**
 * Create overlapping notes across multiple tracks
 */
export function createMultiTrackFixture(): MidiFile {
  return createTestMidiFile({
    name: 'Multi-Track Test',
    notes: [
      // Track 0: Melody
      { noteNumber: 72, startTime: 0, duration: 1, track: 0 },
      { noteNumber: 74, startTime: 1, duration: 1, track: 0 },
      // Track 1: Bass
      { noteNumber: 48, startTime: 0, duration: 2, track: 1 },
    ],
  });
}

/**
 * Create problematic fixture with notes outside piano range
 */
export function createOutOfRangeFixture(): MidiFile {
  return createTestMidiFile({
    name: 'Out of Range Test',
    notes: [
      // Normal notes
      { noteNumber: 60, startTime: 0, duration: 0.5 },
      // Note below piano range (A0 = 21)
      { noteNumber: 10, startTime: 0.5, duration: 0.5 },
      // Note above piano range (C8 = 108)
      { noteNumber: 120, startTime: 1, duration: 0.5 },
      // Normal note after
      { noteNumber: 72, startTime: 1.5, duration: 0.5 },
    ],
  });
}

/**
 * Create fixture with same note in multiple tracks (potential duplicate satisfaction issue)
 */
export function createDuplicateNoteFixture(): MidiFile {
  return createTestMidiFile({
    name: 'Duplicate Note Test',
    notes: [
      // Same note C4 in two tracks at the same time
      { noteNumber: 60, startTime: 0, duration: 1, track: 0 },
      { noteNumber: 60, startTime: 0, duration: 1, track: 1 },
      // Followed by single note
      { noteNumber: 62, startTime: 1.5, duration: 0.5, track: 0 },
    ],
  });
}

/**
 * Default paths to search for MIDI files
 */
const MIDI_SEARCH_PATHS = [
  process.env.HOME + '/cloud/piano/midis',
  process.env.HOME + '/cloud/piano/midi',
  process.env.HOME + '/cloud/piano',  // Files directly in piano folder
  './midis',
  '../midis',
];

/**
 * Find a MIDI file by name (partial match) in known directories
 */
export function findMidiFile(searchTerm: string): string | null {
  const searchLower = searchTerm.toLowerCase();

  for (const basePath of MIDI_SEARCH_PATHS) {
    if (!fs.existsSync(basePath)) continue;

    const files = fs.readdirSync(basePath);
    for (const file of files) {
      if (file.toLowerCase().includes(searchLower) &&
          (file.endsWith('.mid') || file.endsWith('.midi'))) {
        return path.join(basePath, file);
      }
    }
  }

  return null;
}

/**
 * List all available MIDI files in known directories
 */
export function listMidiFiles(): string[] {
  const files: string[] = [];

  for (const basePath of MIDI_SEARCH_PATHS) {
    if (!fs.existsSync(basePath)) continue;

    const dirFiles = fs.readdirSync(basePath);
    for (const file of dirFiles) {
      if (file.endsWith('.mid') || file.endsWith('.midi')) {
        files.push(path.join(basePath, file));
      }
    }
  }

  return files;
}

/**
 * Load a MIDI file from disk and parse it
 */
export function loadMidiFile(filePath: string): MidiFile {
  if (!fs.existsSync(filePath)) {
    throw new Error(`MIDI file not found: ${filePath}`);
  }

  const buffer = fs.readFileSync(filePath);
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  );

  const fileName = path.basename(filePath);
  return parseMidiFile(arrayBuffer, fileName);
}

/**
 * Load a MIDI file by name (searches in known directories)
 */
export function loadMidiByName(name: string): MidiFile {
  const filePath = findMidiFile(name);
  if (!filePath) {
    throw new Error(`Could not find MIDI file matching: ${name}`);
  }
  return loadMidiFile(filePath);
}
