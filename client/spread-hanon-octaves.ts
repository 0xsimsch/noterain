/**
 * Script to analyze the Hanon Condensed MIDI file and spread exercises across octaves.
 *
 * Run with: npx tsx scripts/spread-hanon-octaves.ts
 */

import { parseMidi, writeMidi, MidiData } from 'midi-file';
import * as fs from 'fs';
import * as path from 'path';

const INPUT_FILE = path.join(__dirname, '../midis/Hanon_Condensed_-_Exercises_1_to_30.mid');
const OUTPUT_FILE = path.join(__dirname, '../midis/Hanon_Spread_Octaves.mid');

interface NoteEvent {
  tick: number;
  type: 'noteOn' | 'noteOff';
  noteNumber: number;
  velocity: number;
  channel: number;
  trackIndex: number;
}

interface Exercise {
  index: number;
  startTick: number;
  endTick: number;
  notes: NoteEvent[];
  minNote: number;
  maxNote: number;
}

function analyzeFile() {
  console.log('Reading:', INPUT_FILE);
  const data = fs.readFileSync(INPUT_FILE);
  const midi = parseMidi(data);

  console.log('\n=== MIDI File Structure ===');
  console.log('Format:', midi.header.format);
  console.log('Ticks per beat:', midi.header.ticksPerBeat);
  console.log('Number of tracks:', midi.tracks.length);

  // Collect all note events
  const allNotes: NoteEvent[] = [];

  midi.tracks.forEach((track, trackIndex) => {
    let currentTick = 0;
    let trackName = `Track ${trackIndex}`;

    console.log(`\n--- Track ${trackIndex} ---`);

    for (const event of track) {
      currentTick += event.deltaTime;

      if (event.type === 'trackName') {
        trackName = event.text;
        console.log('Name:', trackName);
      }

      if (event.type === 'noteOn' && event.velocity > 0) {
        allNotes.push({
          tick: currentTick,
          type: 'noteOn',
          noteNumber: event.noteNumber,
          velocity: event.velocity,
          channel: event.channel,
          trackIndex,
        });
      }

      if (event.type === 'noteOff' || (event.type === 'noteOn' && event.velocity === 0)) {
        allNotes.push({
          tick: currentTick,
          type: 'noteOff',
          noteNumber: event.noteNumber,
          velocity: 0,
          channel: event.channel,
          trackIndex,
        });
      }
    }

    const trackNotes = allNotes.filter(n => n.trackIndex === trackIndex && n.type === 'noteOn');
    if (trackNotes.length > 0) {
      const minNote = Math.min(...trackNotes.map(n => n.noteNumber));
      const maxNote = Math.max(...trackNotes.map(n => n.noteNumber));
      console.log('Notes:', trackNotes.length);
      console.log('Range:', midiNoteToName(minNote), '-', midiNoteToName(maxNote));
    }
  });

  // Sort all notes by tick
  allNotes.sort((a, b) => a.tick - b.tick);

  // Find exercises by looking for gaps in the music
  const exercises = identifyExercises(allNotes, midi.header.ticksPerBeat || 480);

  console.log('\n=== Identified Exercises ===');
  exercises.forEach((ex, i) => {
    const noteCount = ex.notes.filter(n => n.type === 'noteOn').length;
    console.log(`Exercise ${i + 1}: ticks ${ex.startTick}-${ex.endTick}, ${noteCount} notes, range: ${midiNoteToName(ex.minNote)}-${midiNoteToName(ex.maxNote)}`);
  });

  return { midi, exercises, allNotes };
}

function identifyExercises(notes: NoteEvent[], ticksPerBeat: number, numExercises: number = 30): Exercise[] {
  const exercises: Exercise[] = [];
  const noteOns = notes.filter(n => n.type === 'noteOn');

  if (noteOns.length === 0) return exercises;

  // Divide notes evenly across exercises (Hanon condensed has all 30 exercises back-to-back)
  const notesPerExercise = Math.ceil(noteOns.length / numExercises);

  for (let i = 0; i < numExercises; i++) {
    const startIdx = i * notesPerExercise;
    const endIdx = Math.min((i + 1) * notesPerExercise, noteOns.length);

    if (startIdx >= noteOns.length) break;

    const exerciseNotes = noteOns.slice(startIdx, endIdx);

    exercises.push({
      index: i,
      startTick: exerciseNotes[0].tick,
      endTick: exerciseNotes[exerciseNotes.length - 1].tick,
      notes: exerciseNotes,
      minNote: Math.min(...exerciseNotes.map(n => n.noteNumber)),
      maxNote: Math.max(...exerciseNotes.map(n => n.noteNumber)),
    });
  }

  return exercises;
}

function midiNoteToName(noteNumber: number): string {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(noteNumber / 12) - 1;
  const noteName = noteNames[noteNumber % 12];
  return `${noteName}${octave}`;
}

function spreadExercisesAcrossOctaves(midi: MidiData, exercises: Exercise[], octaveCopies: number = 4): MidiData {
  const ticksPerBeat = midi.header.ticksPerBeat || 480;

  // Build new MIDI with expanded exercises
  const newTracks: MidiData['tracks'] = [];

  for (const track of midi.tracks) {
    // Collect all events with absolute ticks
    const events: Array<{ tick: number; event: any }> = [];
    let currentTick = 0;

    for (const event of track) {
      currentTick += event.deltaTime;
      events.push({ tick: currentTick, event: { ...event } });
    }

    // Find note events and non-note events
    const noteEvents = events.filter(e =>
      e.event.type === 'noteOn' || e.event.type === 'noteOff'
    );
    const otherEvents = events.filter(e =>
      e.event.type !== 'noteOn' && e.event.type !== 'noteOff' && e.event.type !== 'endOfTrack'
    );

    // Build expanded note events
    const expandedNotes: Array<{ tick: number; event: any }> = [];
    let tickOffset = 0;

    for (let exIdx = 0; exIdx < exercises.length; exIdx++) {
      const exercise = exercises[exIdx];

      // Get note events for this exercise
      const exerciseNoteEvents = noteEvents.filter(e =>
        e.tick >= exercise.startTick && e.tick <= exercise.endTick + ticksPerBeat
      );

      if (exerciseNoteEvents.length === 0) continue;

      const exerciseDuration = exercise.endTick - exercise.startTick + ticksPerBeat;

      // Copy at multiple octaves
      for (let octave = 0; octave < octaveCopies; octave++) {
        const transpose = octave * 12; // Each copy one octave higher

        for (const noteEvent of exerciseNoteEvents) {
          const relativeTick = noteEvent.tick - exercise.startTick;
          const newTick = tickOffset + relativeTick;
          const newNoteNumber = Math.min(127, noteEvent.event.noteNumber + transpose);

          expandedNotes.push({
            tick: newTick,
            event: { ...noteEvent.event, noteNumber: newNoteNumber },
          });
        }

        tickOffset += exerciseDuration;
      }

      console.log(`Exercise ${exIdx + 1}: copied ${octaveCopies}x across octaves (${exercise.notes.length} notes × ${octaveCopies} = ${exercise.notes.length * octaveCopies} notes)`);
    }

    // Sort by tick
    expandedNotes.sort((a, b) => a.tick - b.tick);

    // Convert back to delta times
    const newTrack: MidiData['tracks'][0] = [];

    // Add non-note events at the start (track name, etc.)
    for (const e of otherEvents) {
      if (e.tick === 0) {
        newTrack.push({ ...e.event, deltaTime: 0 });
      }
    }

    let lastTick = 0;
    for (const e of expandedNotes) {
      newTrack.push({
        ...e.event,
        deltaTime: e.tick - lastTick,
      });
      lastTick = e.tick;
    }

    newTrack.push({ deltaTime: 0, type: 'endOfTrack' });
    newTracks.push(newTrack);
  }

  return {
    header: { ...midi.header, numTracks: newTracks.length },
    tracks: newTracks,
  };
}

function main() {
  const { midi, exercises } = analyzeFile();

  if (exercises.length === 0) {
    console.log('\nNo exercises identified. Cannot spread.');
    return;
  }

  console.log('\n=== Spreading Exercises Across Octaves ===');
  const newMidi = spreadExercisesAcrossOctaves(midi, exercises);

  // Write output
  const output = writeMidi(newMidi);
  fs.writeFileSync(OUTPUT_FILE, Buffer.from(output));

  console.log('\nOutput written to:', OUTPUT_FILE);
}

main();
