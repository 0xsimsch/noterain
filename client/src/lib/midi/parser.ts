import { parseMidi, writeMidi, MidiData } from 'midi-file';
import type {
  MidiFile,
  MidiTrack,
  MidiNote,
  TempoChange,
  TimeSignature,
  KeySignature,
} from '../../types/midi';
import { generateId, saveRawMidiData } from '../../utils/storage';

/** Default colors for tracks */
const TRACK_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#ef4444', // red
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
];

/** Parse a MIDI file from ArrayBuffer */
export function parseMidiFile(data: ArrayBuffer, fileName: string): MidiFile {
  const uint8Array = new Uint8Array(data);
  const parsed = parseMidi(uint8Array);

  const ticksPerBeat = parsed.header.ticksPerBeat || 480;
  const tempos = extractTempos(parsed, ticksPerBeat);
  const timeSignature = extractTimeSignature(parsed);
  const keySignature = extractKeySignature(parsed);
  const tracks = extractTracks(parsed, ticksPerBeat, tempos);
  const duration = calculateDuration(tracks);

  const fileId = generateId();

  // Save raw data for later export
  saveRawMidiData(fileId, data);

  const result = {
    id: fileId,
    name: fileName,
    duration,
    ticksPerBeat,
    tempos,
    timeSignature,
    keySignature,
    tracks,
    lastModified: Date.now(),
  };

  console.log('[MidiParser] Parsed file:', fileName);
  console.log('[MidiParser] Duration:', duration.toFixed(2), 'seconds');
  console.log('[MidiParser] Tracks:', tracks.length);
  tracks.forEach((t, i) => {
    console.log(`[MidiParser]   Track ${i}: "${t.name}" - ${t.notes.length} notes, enabled: ${t.enabled}`);
    if (t.notes.length > 0) {
      console.log(`[MidiParser]     First note: time=${t.notes[0].startTime.toFixed(3)}, note=${t.notes[0].noteNumber}`);
    }
  });

  return result;
}

/** Extract tempo changes from MIDI data */
function extractTempos(midi: MidiData, ticksPerBeat: number): TempoChange[] {
  const tempos: TempoChange[] = [];
  let currentTick = 0;
  let currentTempo = 120; // Default 120 BPM
  let currentTime = 0;

  // Tempo events are usually in the first track
  for (const track of midi.tracks) {
    currentTick = 0;
    for (const event of track) {
      currentTick += event.deltaTime;
      if (event.type === 'setTempo') {
        // Calculate time at this point
        const ticksSinceLast = currentTick;
        const microsecondsPerBeat = event.microsecondsPerBeat;
        const bpm = 60000000 / microsecondsPerBeat;

        // Convert ticks to time using previous tempo
        const secondsPerTick = 60 / (currentTempo * ticksPerBeat);
        currentTime = ticksSinceLast * secondsPerTick;

        tempos.push({ time: currentTime, bpm });
        currentTempo = bpm;
      }
    }
  }

  // Ensure we have at least one tempo
  if (tempos.length === 0) {
    tempos.push({ time: 0, bpm: 120 });
  }

  return tempos;
}

/** Extract time signature from MIDI data */
function extractTimeSignature(midi: MidiData): TimeSignature {
  for (const track of midi.tracks) {
    for (const event of track) {
      if (event.type === 'timeSignature') {
        return {
          numerator: event.numerator,
          denominator: Math.pow(2, event.denominator),
        };
      }
    }
  }
  return { numerator: 4, denominator: 4 }; // Default 4/4
}

/** Extract key signature from MIDI data */
function extractKeySignature(midi: MidiData): KeySignature {
  for (const track of midi.tracks) {
    for (const event of track) {
      if (event.type === 'keySignature') {
        return {
          key: (event as any).key,    // -7 to 7 (flats to sharps)
          scale: (event as any).scale, // 0 = major, 1 = minor
        };
      }
    }
  }
  return { key: 0, scale: 0 }; // Default C major
}

/** Convert ticks to seconds using tempo map */
function ticksToSeconds(
  ticks: number,
  ticksPerBeat: number,
  tempos: TempoChange[],
): number {
  if (tempos.length === 0) {
    return (ticks / ticksPerBeat) * (60 / 120);
  }

  // Simple conversion using first tempo (for now)
  // TODO: Handle tempo changes mid-song
  const bpm = tempos[0].bpm;
  const secondsPerBeat = 60 / bpm;
  const secondsPerTick = secondsPerBeat / ticksPerBeat;
  return ticks * secondsPerTick;
}

/** Extract tracks with notes from MIDI data */
function extractTracks(
  midi: MidiData,
  ticksPerBeat: number,
  tempos: TempoChange[],
): MidiTrack[] {
  const tracks: MidiTrack[] = [];

  midi.tracks.forEach((track, index) => {
    const notes: MidiNote[] = [];
    const noteOnTimes: Map<string, { tick: number; velocity: number }> =
      new Map();
    let currentTick = 0;
    let trackName = `Track ${index + 1}`;
    let instrument = 'Piano';

    for (const event of track) {
      currentTick += event.deltaTime;

      if (event.type === 'trackName') {
        trackName = event.text;
      }

      if (event.type === 'programChange') {
        instrument = getInstrumentName(event.programNumber);
      }

      if (event.type === 'noteOn' && event.velocity > 0) {
        const key = `${event.channel}-${event.noteNumber}`;
        noteOnTimes.set(key, { tick: currentTick, velocity: event.velocity });
      }

      if (
        event.type === 'noteOff' ||
        (event.type === 'noteOn' && event.velocity === 0)
      ) {
        const key = `${event.channel}-${event.noteNumber}`;
        const noteOn = noteOnTimes.get(key);

        if (noteOn) {
          const startTime = ticksToSeconds(noteOn.tick, ticksPerBeat, tempos);
          const endTime = ticksToSeconds(currentTick, ticksPerBeat, tempos);

          notes.push({
            noteNumber: event.noteNumber,
            startTime,
            duration: Math.max(0.01, endTime - startTime),
            velocity: noteOn.velocity,
            track: index,
            channel: event.channel,
          });

          noteOnTimes.delete(key);
        }
      }
    }

    // Only add tracks that have notes
    if (notes.length > 0) {
      tracks.push({
        index,
        name: trackName,
        instrument,
        notes: notes.sort((a, b) => a.startTime - b.startTime),
        enabled: true,
        color: TRACK_COLORS[tracks.length % TRACK_COLORS.length],
      });
    }
  });

  return tracks;
}

/** Calculate total duration from tracks */
function calculateDuration(tracks: MidiTrack[]): number {
  let maxEnd = 0;
  for (const track of tracks) {
    for (const note of track.notes) {
      const noteEnd = note.startTime + note.duration;
      if (noteEnd > maxEnd) maxEnd = noteEnd;
    }
  }
  return maxEnd;
}

/** Get instrument name from MIDI program number */
function getInstrumentName(programNumber: number): string {
  const instruments = [
    'Acoustic Grand Piano',
    'Bright Acoustic Piano',
    'Electric Grand Piano',
    'Honky-tonk Piano',
    'Electric Piano 1',
    'Electric Piano 2',
    'Harpsichord',
    'Clavinet',
    'Celesta',
    'Glockenspiel',
    'Music Box',
    'Vibraphone',
    'Marimba',
    'Xylophone',
    'Tubular Bells',
    'Dulcimer',
    'Drawbar Organ',
    'Percussive Organ',
    'Rock Organ',
    'Church Organ',
    'Reed Organ',
    'Accordion',
    'Harmonica',
    'Tango Accordion',
    'Acoustic Guitar (nylon)',
    'Acoustic Guitar (steel)',
    'Electric Guitar (jazz)',
    'Electric Guitar (clean)',
    'Electric Guitar (muted)',
    'Overdriven Guitar',
    'Distortion Guitar',
    'Guitar Harmonics',
    'Acoustic Bass',
    'Electric Bass (finger)',
    'Electric Bass (pick)',
    'Fretless Bass',
    'Slap Bass 1',
    'Slap Bass 2',
    'Synth Bass 1',
    'Synth Bass 2',
    'Violin',
    'Viola',
    'Cello',
    'Contrabass',
    'Tremolo Strings',
    'Pizzicato Strings',
    'Orchestral Harp',
    'Timpani',
  ];
  return instruments[programNumber] || `Program ${programNumber}`;
}

/** Create a new empty MIDI file */
export function createEmptyMidiFile(name: string): MidiFile {
  return {
    id: generateId(),
    name,
    duration: 0,
    ticksPerBeat: 480,
    tempos: [{ time: 0, bpm: 120 }],
    timeSignature: { numerator: 4, denominator: 4 },
    keySignature: { key: 0, scale: 0 },
    tracks: [
      {
        index: 0,
        name: 'Track 1',
        instrument: 'Piano',
        notes: [],
        enabled: true,
        color: TRACK_COLORS[0],
      },
    ],
    lastModified: Date.now(),
  };
}

/** Convert internal format back to MIDI file for export */
export function exportToMidi(file: MidiFile): Uint8Array {
  const ticksPerBeat = file.ticksPerBeat;
  const bpm = file.tempos[0]?.bpm || 120;
  const secondsPerTick = 60 / (bpm * ticksPerBeat);

  // Build MIDI tracks
  const midiTracks: MidiData['tracks'] = [];

  // First track with tempo and time signature
  const metaTrack: MidiData['tracks'][0] = [
    {
      deltaTime: 0,
      type: 'setTempo',
      microsecondsPerBeat: Math.round(60000000 / bpm),
    },
    {
      deltaTime: 0,
      type: 'timeSignature',
      numerator: file.timeSignature.numerator,
      denominator: Math.log2(file.timeSignature.denominator),
      metronome: 24,
      thirtyseconds: 8,
    },
    { deltaTime: 0, type: 'endOfTrack' },
  ];
  midiTracks.push(metaTrack);

  // Add note tracks
  for (const track of file.tracks) {
    const events: MidiData['tracks'][0] = [];
    let lastTick = 0;

    // Track name
    events.push({
      deltaTime: 0,
      type: 'trackName',
      text: track.name,
    });

    // Collect all note events and sort by time
    const noteEvents: Array<{
      tick: number;
      type: 'noteOn' | 'noteOff';
      noteNumber: number;
      velocity: number;
      channel: number;
    }> = [];

    for (const note of track.notes) {
      const startTick = Math.round(note.startTime / secondsPerTick);
      const endTick = Math.round(
        (note.startTime + note.duration) / secondsPerTick,
      );

      noteEvents.push({
        tick: startTick,
        type: 'noteOn',
        noteNumber: note.noteNumber,
        velocity: note.velocity,
        channel: note.channel,
      });

      noteEvents.push({
        tick: endTick,
        type: 'noteOff',
        noteNumber: note.noteNumber,
        velocity: 0,
        channel: note.channel,
      });
    }

    // Sort by tick
    noteEvents.sort((a, b) => a.tick - b.tick);

    // Convert to delta times
    for (const event of noteEvents) {
      events.push({
        deltaTime: event.tick - lastTick,
        type: event.type,
        noteNumber: event.noteNumber,
        velocity: event.velocity,
        channel: event.channel,
      } as any);
      lastTick = event.tick;
    }

    events.push({ deltaTime: 0, type: 'endOfTrack' });
    midiTracks.push(events);
  }

  const midiData: MidiData = {
    header: {
      format: 1,
      numTracks: midiTracks.length,
      ticksPerBeat,
    },
    tracks: midiTracks,
  };

  const bytes = writeMidi(midiData);
  return new Uint8Array(bytes);
}
