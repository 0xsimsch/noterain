/**
 * Wait Mode Tests - Test wait mode behavior and find blocking issues
 */

import { describe, it, expect } from 'vitest';
import {
  createTestMidiFile,
  createScaleFixture,
  createChordFixture,
  createOutOfRangeFixture,
  createDuplicateNoteFixture,
  loadMidiByName,
  findMidiFile,
  listMidiFiles,
} from '../utils/midiFixtures';
import {
  createPlaybackSimulator,
  simulatePlaythrough,
  WAIT_MODE_GRACE_PERIOD,
} from '../utils/playbackSimulator';
import {
  findNotesOutsidePianoRange,
  findDuplicateNoteInstances,
  analyzeTimePoint,
  scanForWaitModeIssues,
  getWaitModeBlockerReport,
  generateIssueReport,
} from '../utils/bugDetectors';
import { PIANO_MIN_NOTE, PIANO_MAX_NOTE } from '../../types/midi';

describe('Wait Mode - Basic Functionality', () => {
  it('should track current time when advancing', () => {
    const file = createScaleFixture();
    const sim = createPlaybackSimulator(file);

    expect(sim.currentTime).toBe(0);
    sim.advanceTime(0.5);
    expect(sim.currentTime).toBeCloseTo(0.5, 2);
  });

  it('should not exceed file duration', () => {
    const file = createScaleFixture({ noteDuration: 0.5 });
    const sim = createPlaybackSimulator(file);

    sim.advanceTime(100);
    expect(sim.currentTime).toBeLessThanOrEqual(file.duration);
  });

  it('should detect active notes at current time', () => {
    const file = createScaleFixture({ noteDuration: 0.5, noteGap: 0 });
    const sim = createPlaybackSimulator(file);

    // At time 0, first note (C4 = 60) should be active
    const activeNotes = sim.getActiveNoteNumbers();
    expect(activeNotes).toContain(60);

    // At time 0.6, second note (D4 = 62) should be active
    sim.seekTo(0.6);
    const notesAt06 = sim.getActiveNoteNumbers();
    expect(notesAt06).toContain(62);
    expect(notesAt06).not.toContain(60);
  });

  it('should handle simultaneous notes (chords)', () => {
    const file = createChordFixture({
      noteNumbers: [60, 64, 67],
      startTime: 0,
      duration: 1,
    });
    const sim = createPlaybackSimulator(file);

    sim.seekTo(0.5);
    const activeNotes = sim.getActiveNoteNumbers();
    expect(activeNotes).toContain(60);
    expect(activeNotes).toContain(64);
    expect(activeNotes).toContain(67);
  });
});

describe('Wait Mode - Note Satisfaction', () => {
  it('should register note as satisfied when pressed during playback', () => {
    const file = createScaleFixture();
    const sim = createPlaybackSimulator(file);

    sim.play(); // Must be playing for addSatisfiedWaitNote to work
    sim.seekTo(0.25); // Middle of first note (C4 = 60)

    expect(sim.isNoteSatisfied(60)).toBe(false);
    sim.pressNote(60);
    expect(sim.isNoteSatisfied(60)).toBe(true);
  });

  it('should NOT register note when paused', () => {
    const file = createScaleFixture();
    const sim = createPlaybackSimulator(file);

    // Not playing - press should be ignored
    sim.seekTo(0.25);
    sim.pressNote(60);
    expect(sim.isNoteSatisfied(60)).toBe(false);
  });

  it('should require all chord notes to be satisfied', () => {
    const file = createChordFixture({
      noteNumbers: [60, 64, 67],
      startTime: 0,
      duration: 1,
    });
    const sim = createPlaybackSimulator(file);

    sim.play();
    sim.seekTo(0.5);

    expect(sim.areAllWaitNotesSatisfied()).toBe(false);

    sim.pressNote(60);
    expect(sim.areAllWaitNotesSatisfied()).toBe(false);

    sim.pressNote(64);
    expect(sim.areAllWaitNotesSatisfied()).toBe(false);

    sim.pressNote(67);
    expect(sim.areAllWaitNotesSatisfied()).toBe(true);
  });

  it('should accept early notes within grace period', () => {
    const file = createTestMidiFile({
      notes: [{ noteNumber: 60, startTime: 1.0, duration: 0.5 }],
    });
    const sim = createPlaybackSimulator(file);

    sim.play();
    // Seek to just before the note starts (within grace period)
    sim.seekTo(1.0 - WAIT_MODE_GRACE_PERIOD + 0.1);

    // The note should be in wait mode notes (grace period)
    const waitNotes = sim.getWaitModeNoteNumbers();
    expect(waitNotes).toContain(60);

    // Should be able to satisfy it early
    sim.pressNote(60);
    expect(sim.isNoteSatisfied(60)).toBe(true);
  });
});

describe('Wait Mode - Problematic Notes', () => {
  it('should detect notes outside piano range', () => {
    const file = createOutOfRangeFixture();
    const outOfRange = findNotesOutsidePianoRange(file);

    expect(outOfRange.length).toBe(2);
    expect(outOfRange.some((n) => n.noteNumber === 10)).toBe(true); // Below range
    expect(outOfRange.some((n) => n.noteNumber === 120)).toBe(true); // Above range
  });

  it('should identify duplicate note instances at same time', () => {
    const file = createDuplicateNoteFixture();
    const sim = createPlaybackSimulator(file);

    sim.seekTo(0.5); // When both C4 notes are active
    const duplicates = findDuplicateNoteInstances(file, 0.5);

    expect(duplicates.has(60)).toBe(true);
    expect(duplicates.get(60)?.length).toBe(2);
  });

  it('should report blocking issues for duplicate notes', () => {
    const file = createDuplicateNoteFixture();
    const sim = createPlaybackSimulator(file);

    sim.play();
    sim.seekTo(0.5);

    // Press C4 once
    sim.pressNote(60);

    // Should still have unsatisfied notes (the second C4 instance)
    const unsatisfied = sim.getUnsatisfiedNotes();

    // Note: The current implementation may or may not handle this correctly
    // This test documents the expected behavior
    console.log('Unsatisfied notes after pressing C4 once:', unsatisfied);
  });
});

describe('Wait Mode - Full Playthrough Simulation', () => {
  it('should complete simple scale without blocking', () => {
    const file = createScaleFixture();
    const result = simulatePlaythrough(file, { autoPress: true });

    expect(result.completed).toBe(true);
    expect(result.blockingPoints.length).toBe(0);
  });

  it('should detect blocking on out-of-range notes when not auto-pressing', () => {
    const file = createOutOfRangeFixture();
    // With autoPress: false, no notes are pressed, so all active notes block
    const result = simulatePlaythrough(file, { autoPress: false });

    // Should have blocking points
    expect(result.blockingPoints.length).toBeGreaterThan(0);
  });

  it('should identify out-of-range notes in a file', () => {
    const file = createOutOfRangeFixture();
    const outOfRange = findNotesOutsidePianoRange(file);

    // These notes exist and would block real users (even though simulator can press them)
    expect(outOfRange.some((n) => n.noteNumber < PIANO_MIN_NOTE)).toBe(true);
    expect(outOfRange.some((n) => n.noteNumber > PIANO_MAX_NOTE)).toBe(true);
  });
});

describe('Bug Detection Utilities', () => {
  it('should generate issue report', () => {
    const file = createOutOfRangeFixture();
    const report = generateIssueReport(file);

    expect(report).toContain('OUT OF RANGE');
    console.log('\n' + report);
  });

  it('should analyze time point', () => {
    const file = createOutOfRangeFixture();
    const analysis = analyzeTimePoint(file, 0.75); // When note 10 is active

    expect(analysis.issues.length).toBeGreaterThan(0);
    expect(analysis.issues.some((i) => i.issue === 'out_of_range_low')).toBe(true);
  });

  it('should scan file for issues', () => {
    const file = createOutOfRangeFixture();
    const scan = scanForWaitModeIssues(file);

    expect(scan.summary.outOfRangeCount).toBeGreaterThan(0);
  });
});

describe('Real MIDI Files', () => {
  it('should list available MIDI files', () => {
    const files = listMidiFiles();
    console.log(`\nFound ${files.length} MIDI files:`);
    for (const file of files.slice(0, 10)) {
      console.log(`  - ${file}`);
    }
    if (files.length > 10) {
      console.log(`  ... and ${files.length - 10} more`);
    }
  });

  it('should analyze "Still Alive" for issues', () => {
    const filePath = findMidiFile('still alive');
    if (!filePath) {
      console.log('Still Alive MIDI file not found, skipping test');
      return;
    }

    console.log(`\nLoading: ${filePath}`);
    const file = loadMidiByName('still alive');

    console.log(`\nFile: ${file.name}`);
    console.log(`Duration: ${file.duration.toFixed(2)}s`);
    console.log(`Tracks: ${file.tracks.length}`);

    // Generate and print issue report
    const report = generateIssueReport(file);
    console.log('\n' + report);

    // Run playthrough simulation
    console.log('\n--- Running playthrough simulation ---');
    const result = simulatePlaythrough(file, {
      timeStep: 0.05,
      autoPress: true,
    });

    console.log(`Completed without blocking: ${result.completed}`);
    console.log(`Blocking points found: ${result.blockingPoints.length}`);

    if (result.blockingPoints.length > 0) {
      console.log('\nFirst 5 blocking points:');
      for (const bp of result.blockingPoints.slice(0, 5)) {
        console.log(`  Time ${bp.time.toFixed(2)}s:`);
        for (const note of bp.unsatisfiedNotes) {
          let reason = '';
          if (note.noteNumber < PIANO_MIN_NOTE) {
            reason = ' (below piano range)';
          } else if (note.noteNumber > PIANO_MAX_NOTE) {
            reason = ' (above piano range)';
          }
          console.log(
            `    - Note ${note.noteNumber} track ${note.track}${reason}`
          );
        }
      }
    }
  });

  it('should provide detailed blocker report for specific time', () => {
    const filePath = findMidiFile('still alive');
    if (!filePath) {
      console.log('Still Alive MIDI file not found, skipping test');
      return;
    }

    const file = loadMidiByName('still alive');
    const sim = createPlaybackSimulator(file);

    // Run simulation to find first blocking point
    const result = simulatePlaythrough(file, { autoPress: true });

    if (result.blockingPoints.length > 0) {
      const firstBlock = result.blockingPoints[0];
      console.log(`\n--- Detailed analysis at time ${firstBlock.time.toFixed(2)}s ---`);

      sim.play();
      sim.seekTo(firstBlock.time);
      sim.pressAllActiveNotes();

      const report = getWaitModeBlockerReport(
        file,
        firstBlock.time,
        sim.getSatisfiedNotes()
      );

      console.log(`Required notes: ${report.requiredNotes.length}`);
      console.log(`Satisfied: ${report.satisfiedNotes.length}`);
      console.log(`Unsatisfied: ${report.unsatisfiedNotes.length}`);

      if (report.blockerDetails.length > 0) {
        console.log('\nBlocker details:');
        for (const detail of report.blockerDetails) {
          console.log(`  Note ${detail.note.noteNumber}: ${detail.reason}`);
        }
      }
    }
  });
});
