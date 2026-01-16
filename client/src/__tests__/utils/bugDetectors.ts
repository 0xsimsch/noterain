/**
 * Bug Detection Utilities - Find problematic notes in MIDI files
 */

import { PIANO_MIN_NOTE, PIANO_MAX_NOTE, MidiFile, MidiNote } from '../../types/midi';
import { getActiveNotesAtTime, getWaitModeNotes } from '../../stores/midiStore';

export interface NoteIssue {
  note: MidiNote;
  issue: 'out_of_range_low' | 'out_of_range_high' | 'duplicate_pitch' | 'very_short' | 'overlapping_same_pitch';
  description: string;
}

export interface TimePointAnalysis {
  time: number;
  activeNotes: MidiNote[];
  waitModeNotes: MidiNote[];
  issues: NoteIssue[];
  duplicatePitches: Map<number, MidiNote[]>;
}

/**
 * Find all notes that are outside the standard 88-key piano range
 */
export function findNotesOutsidePianoRange(file: MidiFile): MidiNote[] {
  const outOfRange: MidiNote[] = [];

  for (const track of file.tracks) {
    if (!track.enabled) continue;

    for (const note of track.notes) {
      if (note.noteNumber < PIANO_MIN_NOTE || note.noteNumber > PIANO_MAX_NOTE) {
        outOfRange.push(note);
      }
    }
  }

  return outOfRange;
}

/**
 * Find duplicate note instances at a specific time
 * (same pitch appearing in multiple tracks or overlapping in same track)
 */
export function findDuplicateNoteInstances(
  file: MidiFile,
  time: number
): Map<number, MidiNote[]> {
  const activeNotes = getActiveNotesAtTime(file, time);
  const byPitch = new Map<number, MidiNote[]>();

  for (const note of activeNotes) {
    const existing = byPitch.get(note.noteNumber) ?? [];
    existing.push(note);
    byPitch.set(note.noteNumber, existing);
  }

  // Filter to only pitches with duplicates
  const duplicates = new Map<number, MidiNote[]>();
  for (const [pitch, notes] of byPitch) {
    if (notes.length > 1) {
      duplicates.set(pitch, notes);
    }
  }

  return duplicates;
}

/**
 * Analyze a specific time point for potential issues
 */
export function analyzeTimePoint(file: MidiFile, time: number): TimePointAnalysis {
  const activeNotes = getActiveNotesAtTime(file, time);
  const waitModeNotes = getWaitModeNotes(file, time);
  const issues: NoteIssue[] = [];
  const duplicatePitches = findDuplicateNoteInstances(file, time);

  // Check each active note for issues
  for (const note of activeNotes) {
    // Out of range checks
    if (note.noteNumber < PIANO_MIN_NOTE) {
      issues.push({
        note,
        issue: 'out_of_range_low',
        description: `Note ${note.noteNumber} is below piano range (min: ${PIANO_MIN_NOTE})`,
      });
    } else if (note.noteNumber > PIANO_MAX_NOTE) {
      issues.push({
        note,
        issue: 'out_of_range_high',
        description: `Note ${note.noteNumber} is above piano range (max: ${PIANO_MAX_NOTE})`,
      });
    }

    // Very short note check (hard to hit)
    if (note.duration < 0.05) {
      issues.push({
        note,
        issue: 'very_short',
        description: `Note ${note.noteNumber} has very short duration: ${note.duration.toFixed(3)}s`,
      });
    }
  }

  // Check for duplicate pitches
  for (const [pitch, notes] of duplicatePitches) {
    for (const note of notes) {
      issues.push({
        note,
        issue: 'duplicate_pitch',
        description: `Pitch ${pitch} appears ${notes.length} times at this time (tracks: ${notes.map((n) => n.track).join(', ')})`,
      });
    }
  }

  return {
    time,
    activeNotes,
    waitModeNotes,
    issues,
    duplicatePitches,
  };
}

/**
 * Scan entire file for potential wait mode blocking issues
 */
export function scanForWaitModeIssues(
  file: MidiFile,
  options?: {
    timeStep?: number;
  }
): {
  issuesByTime: TimePointAnalysis[];
  summary: {
    outOfRangeCount: number;
    duplicatePitchCount: number;
    veryShortNoteCount: number;
    totalIssueCount: number;
  };
} {
  const { timeStep = 0.1 } = options ?? {};
  const issuesByTime: TimePointAnalysis[] = [];

  let outOfRangeCount = 0;
  let duplicatePitchCount = 0;
  let veryShortNoteCount = 0;

  // Track which times we've analyzed to avoid duplicates
  const analyzedTimes = new Set<number>();

  for (let time = 0; time < file.duration; time += timeStep) {
    const roundedTime = Math.round(time * 1000) / 1000;
    if (analyzedTimes.has(roundedTime)) continue;
    analyzedTimes.add(roundedTime);

    const analysis = analyzeTimePoint(file, time);

    if (analysis.issues.length > 0) {
      issuesByTime.push(analysis);

      for (const issue of analysis.issues) {
        switch (issue.issue) {
          case 'out_of_range_low':
          case 'out_of_range_high':
            outOfRangeCount++;
            break;
          case 'duplicate_pitch':
            duplicatePitchCount++;
            break;
          case 'very_short':
            veryShortNoteCount++;
            break;
        }
      }
    }
  }

  return {
    issuesByTime,
    summary: {
      outOfRangeCount,
      duplicatePitchCount,
      veryShortNoteCount,
      totalIssueCount: outOfRangeCount + duplicatePitchCount + veryShortNoteCount,
    },
  };
}

/**
 * Get a detailed report of what's blocking wait mode at a specific time
 */
export function getWaitModeBlockerReport(
  file: MidiFile,
  time: number,
  satisfiedNotes: Map<number, Set<number>>
): {
  requiredNotes: MidiNote[];
  satisfiedNotes: MidiNote[];
  unsatisfiedNotes: MidiNote[];
  blockerDetails: Array<{
    note: MidiNote;
    reason: string;
  }>;
} {
  const activeNotes = getActiveNotesAtTime(file, time);
  const satisfied: MidiNote[] = [];
  const unsatisfied: MidiNote[] = [];
  const blockerDetails: Array<{ note: MidiNote; reason: string }> = [];

  for (const note of activeNotes) {
    const satisfiedStartTimes = satisfiedNotes.get(note.noteNumber);
    const isSatisfied = satisfiedStartTimes?.has(note.startTime) ?? false;

    if (isSatisfied) {
      satisfied.push(note);
    } else {
      unsatisfied.push(note);

      // Determine why it might be blocking
      let reason = 'Note has not been pressed';

      if (note.noteNumber < PIANO_MIN_NOTE) {
        reason = `Note ${note.noteNumber} is below piano range (A0 = ${PIANO_MIN_NOTE})`;
      } else if (note.noteNumber > PIANO_MAX_NOTE) {
        reason = `Note ${note.noteNumber} is above piano range (C8 = ${PIANO_MAX_NOTE})`;
      } else if (satisfiedStartTimes && satisfiedStartTimes.size > 0) {
        // There's a satisfied entry for this pitch, but wrong startTime
        reason = `Pitch ${note.noteNumber} was pressed, but for a different note instance (startTime mismatch)`;
      }

      // Check for duplicates
      const duplicates = findDuplicateNoteInstances(file, time);
      const pitchDuplicates = duplicates.get(note.noteNumber);
      if (pitchDuplicates && pitchDuplicates.length > 1) {
        reason += ` [DUPLICATE: ${pitchDuplicates.length} instances of pitch ${note.noteNumber}]`;
      }

      blockerDetails.push({ note, reason });
    }
  }

  return {
    requiredNotes: activeNotes,
    satisfiedNotes: satisfied,
    unsatisfiedNotes: unsatisfied,
    blockerDetails,
  };
}

/**
 * Find all unique note pitches in a file that are outside playable range
 */
export function getUnplayablePitches(file: MidiFile): {
  belowRange: number[];
  aboveRange: number[];
} {
  const belowRange = new Set<number>();
  const aboveRange = new Set<number>();

  for (const track of file.tracks) {
    for (const note of track.notes) {
      if (note.noteNumber < PIANO_MIN_NOTE) {
        belowRange.add(note.noteNumber);
      } else if (note.noteNumber > PIANO_MAX_NOTE) {
        aboveRange.add(note.noteNumber);
      }
    }
  }

  return {
    belowRange: Array.from(belowRange).sort((a, b) => a - b),
    aboveRange: Array.from(aboveRange).sort((a, b) => a - b),
  };
}

/**
 * Generate a human-readable report of all issues in a MIDI file
 */
export function generateIssueReport(file: MidiFile): string {
  const lines: string[] = [];

  lines.push(`=== MIDI File Issue Report: ${file.name} ===`);
  lines.push(`Duration: ${file.duration.toFixed(2)}s`);
  lines.push(`Tracks: ${file.tracks.length} (${file.tracks.filter((t) => t.enabled).length} enabled)`);
  lines.push('');

  // Out of range notes
  const outOfRange = findNotesOutsidePianoRange(file);
  if (outOfRange.length > 0) {
    lines.push(`⚠️  OUT OF RANGE NOTES: ${outOfRange.length}`);
    const { belowRange, aboveRange } = getUnplayablePitches(file);
    if (belowRange.length > 0) {
      lines.push(`   Below range (< ${PIANO_MIN_NOTE}): ${belowRange.join(', ')}`);
    }
    if (aboveRange.length > 0) {
      lines.push(`   Above range (> ${PIANO_MAX_NOTE}): ${aboveRange.join(', ')}`);
    }
    lines.push('');
  }

  // Scan for issues
  const scan = scanForWaitModeIssues(file);

  if (scan.summary.duplicatePitchCount > 0) {
    lines.push(`⚠️  DUPLICATE PITCHES: ${scan.summary.duplicatePitchCount} occurrences`);
    lines.push('   (Same pitch in multiple tracks at same time - may require multiple presses)');
    lines.push('');
  }

  if (scan.summary.veryShortNoteCount > 0) {
    lines.push(`⚠️  VERY SHORT NOTES: ${scan.summary.veryShortNoteCount}`);
    lines.push('   (Notes < 50ms may be hard to hit in wait mode)');
    lines.push('');
  }

  // List specific problem times
  if (scan.issuesByTime.length > 0) {
    lines.push(`Problem time points: ${scan.issuesByTime.length}`);
    for (const analysis of scan.issuesByTime.slice(0, 10)) {
      lines.push(`  ${analysis.time.toFixed(2)}s: ${analysis.issues.length} issue(s)`);
      for (const issue of analysis.issues.slice(0, 3)) {
        lines.push(`    - ${issue.description}`);
      }
    }
    if (scan.issuesByTime.length > 10) {
      lines.push(`  ... and ${scan.issuesByTime.length - 10} more`);
    }
  }

  if (scan.summary.totalIssueCount === 0) {
    lines.push('✓ No obvious issues detected');
  }

  return lines.join('\n');
}
