/**
 * Dump all notes from a MIDI file in readable format
 */

import { parseMidi } from 'midi-file';
import * as fs from 'fs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npx tsx dump-notes.ts <file.mid>');
  process.exit(1);
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const toName = (n: number) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

const data = fs.readFileSync(file);
const midi = parseMidi(data);
const TPB = midi.header.ticksPerBeat || 480;

console.log('// Ticks per beat:', TPB);
console.log('// 1 beat = quarter note, 0.5 = eighth, 0.25 = sixteenth\n');

midi.tracks.forEach((track, trackIdx) => {
  let trackName = '';
  const notes: { start: number; end: number; note: number; vel: number }[] = [];
  const active = new Map<number, { start: number; vel: number }>();
  let tick = 0;

  for (const ev of track) {
    tick += ev.deltaTime;
    if (ev.type === 'trackName') trackName = ev.text;
    if (ev.type === 'noteOn' && ev.velocity > 0) {
      active.set(ev.noteNumber, { start: tick, vel: ev.velocity });
    }
    if (ev.type === 'noteOff' || (ev.type === 'noteOn' && ev.velocity === 0)) {
      const s = active.get(ev.noteNumber);
      if (s) {
        notes.push({ start: s.start, end: tick, note: ev.noteNumber, vel: s.vel });
        active.delete(ev.noteNumber);
      }
    }
  }

  if (notes.length === 0) return;

  console.log(`// === Track ${trackIdx}: ${trackName} (${notes.length} notes) ===`);
  console.log(`const track${trackIdx}Notes = [`);

  for (const n of notes) {
    const startBeat = (n.start / TPB).toFixed(3);
    const dur = ((n.end - n.start) / TPB).toFixed(3);
    console.log(`  { beat: ${startBeat.padStart(7)}, dur: ${dur.padStart(5)}, note: ${n.note.toString().padStart(2)}, name: '${toName(n.note).padStart(3)}' },`);
  }

  console.log('];\n');
});
