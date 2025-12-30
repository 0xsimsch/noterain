/**
 * Analyze a MIDI file structure
 */

import { parseMidi } from 'midi-file';
import * as fs from 'fs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npx tsx analyze-midi.ts <file.mid>');
  process.exit(1);
}

const data = fs.readFileSync(file);
const midi = parseMidi(data);

console.log('=== MIDI File Analysis ===');
console.log('File:', file);
console.log('Format:', midi.header.format);
console.log('Ticks per beat:', midi.header.ticksPerBeat);
console.log('Number of tracks:', midi.tracks.length);

midi.tracks.forEach((track, i) => {
  let trackName = '';
  let noteCount = 0;
  let minNote = 127;
  let maxNote = 0;
  let programNumber: number | undefined;
  let currentTick = 0;
  let firstNoteTick = 0;
  let lastNoteTick = 0;

  for (const event of track) {
    currentTick += event.deltaTime;

    if (event.type === 'trackName') {
      trackName = event.text;
    }
    if (event.type === 'programChange') {
      programNumber = event.programNumber;
    }
    if (event.type === 'noteOn' && event.velocity > 0) {
      noteCount++;
      if (event.noteNumber < minNote) minNote = event.noteNumber;
      if (event.noteNumber > maxNote) maxNote = event.noteNumber;
      if (noteCount === 1) firstNoteTick = currentTick;
      lastNoteTick = currentTick;
    }
  }

  if (noteCount > 0 || trackName) {
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const toNoteName = (n: number) => `${noteNames[n % 12]}${Math.floor(n / 12) - 1}`;

    console.log(`\n--- Track ${i}: ${trackName || '(unnamed)'} ---`);
    console.log('  Notes:', noteCount);
    if (noteCount > 0) {
      console.log('  Range:', toNoteName(minNote), '-', toNoteName(maxNote));
      console.log('  MIDI range:', minNote, '-', maxNote);
    }
    if (programNumber !== undefined) {
      console.log('  Program:', programNumber);
    }
  }
});
