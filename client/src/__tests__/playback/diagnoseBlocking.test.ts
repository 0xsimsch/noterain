/**
 * Diagnostic Test - Simulate playthrough and find WHY notes block
 *
 * Run with: bun run test -- diagnoseBlocking
 */

import { describe, it } from 'vitest';
import { loadMidiFile, listMidiFiles } from '../utils/midiFixtures';
import { createPlaybackSimulator } from '../utils/playbackSimulator';
import {
  findDuplicateNoteInstances,
  generateIssueReport,
} from '../utils/bugDetectors';
import { getActiveNotesAtTime } from '../../stores/midiStore';
import { PIANO_MIN_NOTE, PIANO_MAX_NOTE, MidiFile, MidiNote } from '../../types/midi';

/**
 * Simulate a full playthrough and find all points where wait mode would block
 */
function findAllBlockingPoints(
  file: MidiFile,
  options?: { timeStep?: number }
): Array<{
  time: number;
  activeNotes: MidiNote[];
  cannotSatisfy: Array<{ note: MidiNote; reason: string }>;
}> {
  const { timeStep = 0.01 } = options ?? {}; // Fine-grained stepping
  const sim = createPlaybackSimulator(file);
  const blockingPoints: Array<{
    time: number;
    activeNotes: MidiNote[];
    cannotSatisfy: Array<{ note: MidiNote; reason: string }>;
  }> = [];

  sim.play();
  sim.setWaitMode(true);

  // Track which note instances we've already reported
  const reportedNoteKeys = new Set<string>();

  for (let time = 0; time < file.duration; time += timeStep) {
    sim.seekTo(time);

    const activeNotes = getActiveNotesAtTime(file, time);
    if (activeNotes.length === 0) continue;

    // For each active note, determine if it can be satisfied
    const cannotSatisfy: Array<{ note: MidiNote; reason: string }> = [];

    for (const note of activeNotes) {
      const noteKey = `${note.noteNumber}:${note.startTime.toFixed(4)}:${note.track}`;
      if (reportedNoteKeys.has(noteKey)) continue;

      let reason: string | null = null;

      // Check 1: Out of piano range
      if (note.noteNumber < PIANO_MIN_NOTE) {
        reason = `Note ${note.noteNumber} is BELOW piano range (min A0 = ${PIANO_MIN_NOTE})`;
      } else if (note.noteNumber > PIANO_MAX_NOTE) {
        reason = `Note ${note.noteNumber} is ABOVE piano range (max C8 = ${PIANO_MAX_NOTE})`;
      }

      // Check 2: Duplicate pitch at same time (same pitch in multiple tracks)
      if (!reason) {
        const duplicates = findDuplicateNoteInstances(file, time);
        const pitchDuplicates = duplicates.get(note.noteNumber);
        if (pitchDuplicates && pitchDuplicates.length > 1) {
          // This pitch appears multiple times - user would need to press it multiple times
          // but satisfaction logic may not handle this correctly
          reason = `DUPLICATE: Pitch ${note.noteNumber} appears ${pitchDuplicates.length} times simultaneously (tracks: ${pitchDuplicates.map(n => n.track).join(', ')}). Single keypress may only satisfy one instance.`;
        }
      }

      // Check 3: Very short duration (hard to hit in grace window)
      if (!reason && note.duration < 0.02) {
        reason = `Very short note (${(note.duration * 1000).toFixed(1)}ms) - may be missed`;
      }

      if (reason) {
        cannotSatisfy.push({ note, reason });
        reportedNoteKeys.add(noteKey);
      }
    }

    if (cannotSatisfy.length > 0) {
      blockingPoints.push({
        time,
        activeNotes,
        cannotSatisfy,
      });
    }
  }

  return blockingPoints;
}

/**
 * Format time as MM:SS.ms
 */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toFixed(2).padStart(5, '0')}`;
}

/**
 * Get note name from MIDI number
 */
function noteName(n: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(n / 12) - 1;
  return `${names[n % 12]}${octave}`;
}

describe('Diagnose Wait Mode Blocking', () => {
  it('should analyze a MIDI file for blocking issues', () => {
    // List available files
    const files = listMidiFiles();
    console.log('\n=== Available MIDI files ===');
    files.forEach((f, i) => console.log(`  [${i}] ${f.split('/').pop()}`));

    // Load a specific file - change this path to test different files
    const testFile = files[0]; // Change index or use direct path
    if (!testFile) {
      console.log('No MIDI files found');
      return;
    }

    console.log(`\n=== Analyzing: ${testFile.split('/').pop()} ===\n`);

    const file = loadMidiFile(testFile);
    console.log(`Duration: ${formatTime(file.duration)}`);
    console.log(`Tracks: ${file.tracks.length}`);
    for (const track of file.tracks) {
      console.log(`  Track ${track.index}: ${track.notes.length} notes (enabled: ${track.enabled})`);
    }

    // Generate issue report
    console.log('\n' + generateIssueReport(file));

    // Find all blocking points
    console.log('\n=== Simulating playthrough ===\n');
    const blockingPoints = findAllBlockingPoints(file, { timeStep: 0.02 });

    if (blockingPoints.length === 0) {
      console.log('✓ No blocking issues detected - all notes can be satisfied');
    } else {
      console.log(`⚠️  Found ${blockingPoints.length} blocking point(s):\n`);

      for (const bp of blockingPoints) {
        console.log(`Time ${formatTime(bp.time)}:`);
        for (const { note, reason } of bp.cannotSatisfy) {
          console.log(`  Note ${note.noteNumber} (${noteName(note.noteNumber)}) track ${note.track}: ${reason}`);
        }
        console.log('');
      }
    }
  });

  it('should test specific MIDI file by path', () => {
    // Hardcode a specific file path here to test
    const testPath = process.env.TEST_MIDI_FILE;
    if (!testPath) {
      console.log('Set TEST_MIDI_FILE env var to test a specific file');
      console.log('Example: TEST_MIDI_FILE=/path/to/file.mid bun run test -- diagnoseBlocking');
      return;
    }

    console.log(`\n=== Testing: ${testPath} ===\n`);
    const file = loadMidiFile(testPath);

    console.log(generateIssueReport(file));
    console.log('\n=== Blocking Analysis ===\n');

    const blockingPoints = findAllBlockingPoints(file);
    if (blockingPoints.length === 0) {
      console.log('✓ No blocking issues found');
    } else {
      console.log(`Found ${blockingPoints.length} blocking points`);
      for (const bp of blockingPoints.slice(0, 20)) {
        console.log(`\nTime ${formatTime(bp.time)}:`);
        for (const { note, reason } of bp.cannotSatisfy) {
          console.log(`  ${noteName(note.noteNumber)}: ${reason}`);
        }
      }
      if (blockingPoints.length > 20) {
        console.log(`\n... and ${blockingPoints.length - 20} more`);
      }
    }
  });
});
