import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Renderer,
  Stave,
  StaveNote,
  GhostNote,
  Voice,
  Formatter,
  Accidental,
  StaveConnector,
  Beam,
  Fraction,
} from 'vexflow';
import { useMidiStore } from '../../stores/midiStore';
import type { MidiNote, MidiTrack } from '../../types/midi';
import styles from './SheetMusic.module.css';

interface SheetMusicProps {
  /** Override beats per measure (defaults to file's time signature) */
  beatsPerMeasure?: number;
}

/**
 * Convert MIDI key signature (-7 to 7) to VexFlow key name
 * Negative = flats, positive = sharps
 */
function midiKeyToVexFlow(key: number, scale: number): string {
  // Major keys by number of sharps/flats
  const majorKeys: Record<string, string> = {
    '-7': 'Cb',
    '-6': 'Gb',
    '-5': 'Db',
    '-4': 'Ab',
    '-3': 'Eb',
    '-2': 'Bb',
    '-1': 'F',
    '0': 'C',
    '1': 'G',
    '2': 'D',
    '3': 'A',
    '4': 'E',
    '5': 'B',
    '6': 'F#',
    '7': 'C#',
  };
  // Minor keys (relative minor)
  const minorKeys: Record<string, string> = {
    '-7': 'Ab',
    '-6': 'Eb',
    '-5': 'Bb',
    '-4': 'F',
    '-3': 'C',
    '-2': 'G',
    '-1': 'D',
    '0': 'A',
    '1': 'E',
    '2': 'B',
    '3': 'F#',
    '4': 'C#',
    '5': 'G#',
    '6': 'D#',
    '7': 'A#',
  };

  const keyMap = scale === 1 ? minorKeys : majorKeys;
  return keyMap[String(key)] || 'C';
}

/** Get which pitch classes have sharps/flats for a given MIDI key signature */
function getKeySignatureAlterations(key: number): {
  sharps: Set<number>;
  flats: Set<number>;
} {
  // Order of sharps: F C G D A E B (pitch classes: 5, 0, 7, 2, 9, 4, 11 -> mod 12 for black keys: 6, 1, 8, 3, 10)
  // Order of flats: B E A D G C F (pitch classes: 11, 4, 9, 2, 7, 0, 5 -> mod 12 for black keys: 10, 3, 8, 1, 6)
  const sharpOrder = [6, 1, 8, 3, 10, 5, 0]; // F#, C#, G#, D#, A#, E#, B#
  const flatOrder = [10, 3, 8, 1, 6, 11, 4]; // Bb, Eb, Ab, Db, Gb, Cb, Fb

  const sharps = new Set<number>();
  const flats = new Set<number>();

  if (key > 0) {
    for (let i = 0; i < key; i++) {
      sharps.add(sharpOrder[i]);
    }
  } else if (key < 0) {
    for (let i = 0; i < -key; i++) {
      flats.add(flatOrder[i]);
    }
  }

  return { sharps, flats };
}

/** Detect key signature from notes when MIDI file doesn't have one */
function detectKeySignature(notes: MidiNote[]): number {
  if (notes.length === 0) return 0;

  // Count pitch classes (0-11)
  const pitchCounts = new Array(12).fill(0);
  for (const note of notes) {
    pitchCounts[note.noteNumber % 12]++;
  }

  // Test each key signature and count how many accidentals would be needed
  // Prefer keys with fewer accidentals in signature (closer to C major)
  let bestKey = 0;
  let fewestAccidentals = Infinity;

  // Only test common keys (-4 to 4, i.e., Ab major to E major)
  for (let key = -4; key <= 4; key++) {
    const { sharps, flats } = getKeySignatureAlterations(key);
    let accidentalsNeeded = 0;

    for (let pc = 0; pc < 12; pc++) {
      const count = pitchCounts[pc];
      if (count === 0) continue;

      const isBlackKey = [1, 3, 6, 8, 10].includes(pc);

      if (isBlackKey) {
        // Black key needs accidental if not in key signature
        if (!sharps.has(pc) && !flats.has(pc)) {
          accidentalsNeeded += count;
        }
      }
      // White keys don't need accidentals in these common keys
    }

    // Prefer fewer accidentals, with tiebreaker favoring fewer sharps/flats in signature
    const tiebreaker = Math.abs(key) * 0.001;
    const score = accidentalsNeeded + tiebreaker;

    if (score < fewestAccidentals) {
      fewestAccidentals = score;
      bestKey = key;
    }
  }

  return bestKey;
}

/** Convert MIDI note number to VexFlow note name, considering key signature */
function midiToVexFlow(
  noteNumber: number,
  keyNum: number,
): { key: string; accidental?: string } {
  const octave = Math.floor(noteNumber / 12) - 1;
  const pc = noteNumber % 12;

  const { sharps, flats } = getKeySignatureAlterations(keyNum);

  // Pitch classes: C=0, C#=1, D=2, D#=3, E=4, F=5, F#=6, G=7, G#=8, A=9, A#=10, B=11
  const naturalNames = [
    'c',
    'c',
    'd',
    'd',
    'e',
    'f',
    'f',
    'g',
    'g',
    'a',
    'a',
    'b',
  ];
  const isBlackKey = [1, 3, 6, 8, 10].includes(pc);

  let noteName = naturalNames[pc];
  let accidental: string | undefined;

  if (isBlackKey) {
    if (sharps.has(pc)) {
      // In key signature as sharp - no accidental needed
      accidental = undefined;
    } else if (flats.has(pc)) {
      // In key signature as flat - use flat note name, no accidental
      const flatNames = [
        'c',
        'd',
        'd',
        'e',
        'e',
        'f',
        'g',
        'g',
        'a',
        'a',
        'b',
        'b',
      ];
      noteName = flatNames[pc];
      accidental = undefined;
    } else {
      // Not in key signature - need accidental
      accidental = '#';
    }
  }

  return {
    key: `${noteName}/${octave}`,
    accidental,
  };
}

/** Get note duration string for VexFlow based on beats */
function beatsToDuration(beats: number): string {
  if (beats >= 3.5) return 'w'; // whole (4 beats)
  if (beats >= 1.75) return 'h'; // half (2 beats)
  if (beats >= 0.875) return 'q'; // quarter (1 beat)
  if (beats >= 0.4375) return '8'; // eighth (0.5 beats)
  if (beats >= 0.21875) return '16'; // sixteenth (0.25 beats)
  return '32'; // thirty-second (0.125 beats)
}

/** Get the beat value for a VexFlow duration */
function durationToBeats(duration: string): number {
  switch (duration) {
    case 'w':
      return 4;
    case 'h':
      return 2;
    case 'q':
      return 1;
    case '8':
      return 0.5;
    case '16':
      return 0.25;
    case '32':
      return 0.125;
    default:
      return 1;
  }
}

/** Generate rests to fill a gap of specified beats */
function generateRests(beats: number): string[] {
  const rests: string[] = [];
  let remaining = beats;

  const restValues: [string, number][] = [
    ['h', 2],
    ['q', 1],
    ['8', 0.5],
    ['16', 0.25],
    ['32', 0.125],
  ];

  while (remaining >= 0.125) {
    for (const [duration, value] of restValues) {
      if (remaining >= value - 0.001) {
        rests.push(duration + 'r');
        remaining -= value;
        break;
      }
    }
    if (remaining > 0 && remaining < 0.125) break;
  }

  return rests;
}

/**
 * Get VexFlow beam groupings based on time signature.
 *
 * Music notation rules:
 * - Only 8th notes or shorter can be beamed
 * - "A new beam = a new beat" - beam notes within the same beat
 * - Never beam across bar lines
 * - Never beam across the center of a measure (critical in 4/4)
 */
function getBeamGroupsForTimeSignature(
  beatsPerMeasure: number,
  beatValue: number,
): Fraction[] {
  // Compound meters (6/8, 9/8, 12/8) - beam in groups of 3 eighth notes
  if (beatValue === 8 && beatsPerMeasure % 3 === 0) {
    const numGroups = beatsPerMeasure / 3;
    return Array(numGroups)
      .fill(null)
      .map(() => new Fraction(3, 8));
  }

  // Simple meters - beam based on beat structure
  switch (beatValue) {
    case 4: // Quarter note beats
      switch (beatsPerMeasure) {
        case 4: // 4/4 - Two groups of 4 eighths (beats 1-2 and 3-4, NEVER across center)
          return [new Fraction(4, 8), new Fraction(4, 8)];
        case 3: // 3/4 - Three groups of 2 eighths
          return [new Fraction(2, 8), new Fraction(2, 8), new Fraction(2, 8)];
        case 2: // 2/4 - One group of 4 eighths
          return [new Fraction(4, 8)];
        case 6: // 6/4 - Two groups of 6 eighths
          return [new Fraction(6, 8), new Fraction(6, 8)];
        default:
          // Default to 2 eighths per beat
          return Array(beatsPerMeasure)
            .fill(null)
            .map(() => new Fraction(2, 8));
      }
    case 8: // Eighth note beats (simple, not compound - e.g., 5/8, 7/8)
      if (beatsPerMeasure === 5) {
        return [new Fraction(3, 8), new Fraction(2, 8)];
      }
      if (beatsPerMeasure === 7) {
        return [new Fraction(2, 8), new Fraction(2, 8), new Fraction(3, 8)];
      }
      // Default grouping for other 8th note meters
      return [new Fraction(beatsPerMeasure, 8)];
    case 2: // Half note beats (2/2, 3/2, etc.)
      // Beam in groups of 4 eighths per half-note beat
      return Array(beatsPerMeasure)
        .fill(null)
        .map(() => new Fraction(4, 8));
    case 16: // Sixteenth note beats
      return [new Fraction(beatsPerMeasure, 16)];
    default:
      // Fallback: 2 eighths per beat
      return [new Fraction(2, 8)];
  }
}

/**
 * Calculate note density to determine optimal measures per line.
 * Denser music (more 16th notes) needs fewer measures per line.
 * Sparser music (whole/half notes) can have more measures per line.
 *
 * @returns Density factor (< 1 for dense, > 1 for sparse, 1 for normal)
 */
function calculateNoteDensity(notes: MidiNote[], bpm: number): number {
  if (notes.length === 0) return 1;

  const beatsPerSecond = bpm / 60;

  // Count notes by duration category
  let shortNotes = 0; // 16th notes and shorter (< 0.375 beats)
  let normalNotes = 0; // 8th and quarter notes (0.375 - 1.5 beats)
  let longNotes = 0; // Half notes and longer (> 1.5 beats)

  for (const note of notes) {
    const beats = note.duration * beatsPerSecond;
    if (beats < 0.375) {
      shortNotes++;
    } else if (beats > 1.5) {
      longNotes++;
    } else {
      normalNotes++;
    }
  }

  const total = shortNotes + normalNotes + longNotes;
  if (total === 0) return 1;

  // Calculate density factor:
  // - High proportion of short notes = lower factor (fewer measures per line)
  // - High proportion of long notes = higher factor (more measures per line)
  const shortRatio = shortNotes / total;
  const longRatio = longNotes / total;
  const densityFactor = 1 - shortRatio * 0.5 + longRatio * 0.5;

  return Math.max(0.5, Math.min(1.5, densityFactor));
}

/**
 * Calculate optimal number of measures per line based on time signature and note density.
 *
 * Standard rules:
 * - 4-8 measures per line is standard
 * - Dense music (16th notes): 2-3 measures per line
 * - Sparse music (whole/half notes): up to 10-12 measures per line
 * - Target ~16 quarter notes of content per line as baseline
 */
function calculateMeasuresPerLine(
  quarterNotesPerMeasure: number,
  densityFactor: number,
): number {
  // Target ~16 quarter notes worth of content per line (4 measures for 4/4)
  const targetQuarterNotesPerLine = 16;

  // Base calculation: how many measures to reach target
  const baseMeasures = targetQuarterNotesPerLine / quarterNotesPerMeasure;

  // Adjust for note density
  const adjustedMeasures = baseMeasures * densityFactor;

  // Clamp to reasonable range: 2-6 measures per line
  return Math.max(2, Math.min(6, Math.round(adjustedMeasures)));
}

/** Get note duration string for VexFlow */
function getDuration(durationSeconds: number, bpm: number): string {
  const beatsPerSecond = bpm / 60;
  const beats = durationSeconds * beatsPerSecond;
  return beatsToDuration(beats);
}

/** Determine clef based on average note pitch */
function getClefForTrack(notes: MidiNote[]): 'treble' | 'bass' {
  if (notes.length === 0) return 'treble';
  const avgNote =
    notes.reduce((sum, n) => sum + n.noteNumber, 0) / notes.length;
  return avgNote >= 60 ? 'treble' : 'bass'; // Middle C = 60
}

/** Group notes into measures */
interface Measure {
  startTime: number;
  endTime: number;
  notes: MidiNote[];
}

function groupNotesIntoMeasures(
  notes: MidiNote[],
  duration: number,
  bpm: number,
  beatsPerMeasure: number,
  beatValue: number = 4,
): Measure[] {
  // MIDI BPM is always based on quarter notes
  const secondsPerQuarterNote = 60 / bpm;
  // Adjust for beat value: beatValue=4 means quarter note beats, beatValue=8 means eighth note beats
  // One beat of the given value = (4 / beatValue) quarter notes
  const secondsPerBeat = secondsPerQuarterNote * (4 / beatValue);
  const secondsPerMeasure = secondsPerBeat * beatsPerMeasure;
  const measureCount = Math.ceil(duration / secondsPerMeasure);
  const measures: Measure[] = [];

  for (let i = 0; i < measureCount; i++) {
    const startTime = i * secondsPerMeasure;
    const endTime = (i + 1) * secondsPerMeasure;
    // Use small tolerance to handle floating-point precision at measure boundaries
    const measureNotes = notes.filter((n) => {
      // Quantize note start time to nearest 32nd note to avoid boundary issues
      const quantizeGrid = secondsPerBeat / 8; // 32nd note
      const quantizedTime =
        Math.round(n.startTime / quantizeGrid) * quantizeGrid;
      return quantizedTime >= startTime && quantizedTime < endTime;
    });
    measures.push({ startTime, endTime, notes: measureNotes });
  }

  return measures;
}

/** Convert hex color to VexFlow color format */
function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    return `rgb(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)})`;
  }
  return hex;
}

/** Stored position info for a rendered note */
interface NotePosition {
  x: number;
  y: number;
  width: number;
  height: number;
  startTime: number;
  endTime: number;
}

/**
 * Normalize unusual MIDI time signatures to standard notation.
 * Many MIDI files have incorrectly encoded denominators (e.g., 4/16 instead of 4/4).
 * This function normalizes them to practical values for sheet music display.
 */
function normalizeTimeSignature(
  numerator: number,
  denominator: number,
): { numerator: number; denominator: number } {
  // Many MIDI files have incorrectly encoded time signatures.
  // The MIDI spec stores denominator as a power of 2, so:
  //   denominator=2 means 2^2=4 (quarter notes) - CORRECT for 4/4
  //   denominator=4 means 2^4=16 (sixteenth notes) - WRONG, often meant to be 4/4
  //
  // Common encoding errors to fix:
  //   4/16 → 4/4 (most common error)
  //   3/16 → 3/4
  //   6/16 → 6/8 (compound meter)
  //   2/16 → 2/4
  //   1/256 → likely encoding garbage

  let normNum = numerator;
  let normDenom = denominator;

  // Fix x/16 which is almost always an encoding error
  // Real x/16 time signatures are extremely rare in practice
  if (normDenom === 16) {
    // Check for compound meter patterns (divisible by 3) → convert to /8
    if (normNum % 3 === 0 && normNum >= 6) {
      normDenom = 8; // 6/16 → 6/8, 9/16 → 9/8, 12/16 → 12/8
    } else {
      normDenom = 4; // 4/16 → 4/4, 3/16 → 3/4, 2/16 → 2/4
    }
  }

  // Fix very large denominators (32, 64, 128, 256...)
  // These are almost certainly encoding errors
  while (normDenom > 16) {
    if (normNum % 2 === 0 && normNum > 1) {
      normNum = normNum / 2;
    }
    normDenom = normDenom / 2;
  }

  // After normalization, fix any remaining /16 from the division
  if (normDenom === 16) {
    if (normNum % 3 === 0 && normNum >= 6) {
      normDenom = 8;
    } else {
      normDenom = 4;
    }
  }

  // Ensure denominator is a power of 2 (1, 2, 4, 8)
  const validDenominators = [1, 2, 4, 8];
  if (!validDenominators.includes(normDenom)) {
    normDenom = validDenominators.reduce((prev, curr) =>
      Math.abs(curr - normDenom) < Math.abs(prev - normDenom) ? curr : prev
    );
  }

  // Ensure numerator is at least 1
  normNum = Math.max(1, Math.round(normNum));

  return { numerator: normNum, denominator: normDenom };
}

export function SheetMusic({
  beatsPerMeasure: beatsPerMeasureProp,
}: SheetMusicProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const highlightsRef = useRef<HTMLDivElement>(null);
  const [renderedHeight, setRenderedHeight] = useState(0);

  // Store note positions for highlighting
  const notePositionsRef = useRef<NotePosition[]>([]);

  // Subscribe to current file and theme for re-rendering
  const currentFileId = useMidiStore((state) => state.currentFileId);
  const files = useMidiStore((state) => state.files);
  const currentFile = files.find((f) => f.id === currentFileId) || null;
  const theme = useMidiStore((state) => state.settings.theme);

  const getPlaybackTime = useCallback(() => {
    return useMidiStore.getState().playback.currentTime;
  }, []);

  // Render sheet music
  useEffect(() => {
    const container = svgContainerRef.current;
    if (!container) return;

    if (!currentFile || currentFile.tracks.length === 0) {
      const existingSvg = container.querySelector('svg');
      if (existingSvg) existingSvg.remove();
      return;
    }

    // Clear previous SVG (but keep progress line)
    const existingSvg = container.querySelector('svg');
    if (existingSvg) existingSvg.remove();

    // Get enabled tracks with notes
    const enabledTracks = currentFile.tracks.filter(
      (t) => t.enabled && t.notes.length > 0,
    );

    if (enabledTracks.length === 0) {
      setRenderedHeight(0);
      return;
    }

    // Get tempo (use first tempo or default)
    const bpm = currentFile.tempos.length > 0 ? currentFile.tempos[0].bpm : 120;

    // Get time signature from file, normalize unusual denominators
    const rawTimeSignature = currentFile.timeSignature ?? { numerator: 4, denominator: 4 };
    const normalizedTimeSignature = normalizeTimeSignature(
      rawTimeSignature.numerator,
      rawTimeSignature.denominator,
    );
    // Allow prop override for beats per measure, otherwise use file's time signature
    const beatsPerMeasure = beatsPerMeasureProp ?? normalizedTimeSignature.numerator;
    const beatValue = normalizedTimeSignature.denominator;

    // Get key signature from file, or detect from notes if not present
    const allNotes = enabledTracks.flatMap((t) => t.notes);
    const fileKeyNum = currentFile.keySignature?.key ?? 0;
    const keyNum = fileKeyNum !== 0 ? fileKeyNum : detectKeySignature(allNotes);
    const keyScale = currentFile.keySignature?.scale ?? 0;
    const vexFlowKey = midiKeyToVexFlow(keyNum, keyScale);

    // Group each track's notes into measures
    const trackMeasures: {
      track: MidiTrack;
      measures: Measure[];
      clef: 'treble' | 'bass';
    }[] = enabledTracks.map((track) => ({
      track,
      measures: groupNotesIntoMeasures(
        track.notes,
        currentFile.duration,
        bpm,
        beatsPerMeasure,
        beatValue,
      ),
      clef: getClefForTrack(track.notes),
    }));

    // Calculate quarter notes per measure for layout scaling
    // e.g., 4/4 = 4, 3/4 = 3, 6/8 = 3, 2/4 = 2
    const quarterNotesPerMeasure = beatsPerMeasure * (4 / beatValue);

    // Calculate note density and optimal measures per line
    const densityFactor = calculateNoteDensity(allNotes, bpm);
    const stavesPerLine = calculateMeasuresPerLine(quarterNotesPerMeasure, densityFactor);

    // Adjust stave width to fill available space (aim for ~1200px total width)
    const totalWidth = 1200;
    const leftMargin = 10;
    const staveWidth = Math.floor((totalWidth - leftMargin * 2) / stavesPerLine);
    const singleStaveHeight = 80;
    const trackSpacing = 20; // Space between track groups
    const topMargin = 40;

    // Height for one "system" (all tracks for one set of measures)
    const systemHeight =
      enabledTracks.length * singleStaveHeight + trackSpacing;

    const measureCount = trackMeasures[0]?.measures.length || 0;
    const lineCount = Math.ceil(measureCount / stavesPerLine);
    const totalHeight = lineCount * systemHeight + topMargin * 2;

    setRenderedHeight(totalHeight);

    // Create renderer
    const renderer = new Renderer(container, Renderer.Backends.SVG);
    renderer.resize(stavesPerLine * staveWidth + leftMargin * 2, totalHeight);
    const context = renderer.getContext();
    context.setFont('Arial', 10);

    // Set theme-aware colors for notation elements
    const textColor = theme === 'latte' ? '#4c4f69' : '#cdd6f4';
    const staffColor = theme === 'latte' ? '#5c5f77' : '#a6adc8';
    context.setFillStyle(textColor);
    context.setStrokeStyle(staffColor);

    // Collect note positions for highlighting
    const notePositions: NotePosition[] = [];

    // Render each measure
    for (let measureIndex = 0; measureIndex < measureCount; measureIndex++) {
      const lineIndex = Math.floor(measureIndex / stavesPerLine);
      const posInLine = measureIndex % stavesPerLine;
      const x = leftMargin + posInLine * staveWidth;
      const baseY = topMargin + lineIndex * systemHeight;

      const staves: Stave[] = [];
      const voices: Voice[] = [];
      const voiceData: {
        voice: Voice;
        stave: Stave;
        staveNotes: (StaveNote | GhostNote)[];
        noteTimings: {
          startTime: number;
          endTime: number;
          staveNoteIndex: number;
        }[];
      }[] = [];

      // First pass: create all staves and voices
      trackMeasures.forEach(({ track, measures, clef }, trackIndex) => {
        const y = baseY + trackIndex * singleStaveHeight;
        const measure = measures[measureIndex];

        // Create stave
        const stave = new Stave(x, y, staveWidth);
        if (posInLine === 0) {
          stave.addClef(clef);
          stave.addKeySignature(vexFlowKey);
          // Only show time signature on the first line
          if (lineIndex === 0) {
            stave.addTimeSignature(`${beatsPerMeasure}/${beatValue}`);
          }
        }
        stave.setContext(context).draw();
        staves.push(stave);

        // Skip empty measures
        if (!measure || measure.notes.length === 0) {
          return;
        }

        // Group simultaneous notes (chords) by their beat position
        // Use quarter notes as the internal beat unit (matches MIDI BPM and VexFlow durations)
        const secondsPerQuarterNote = 60 / bpm;
        // quarterNotesPerMeasure is defined in outer scope (e.g., 6/8 = 3 quarter notes)
        const noteGroups: Map<number, MidiNote[]> = new Map();
        for (const note of measure.notes) {
          const quarterBeatInMeasure =
            (note.startTime - measure.startTime) / secondsPerQuarterNote;
          const quantizedBeat = Math.round(quarterBeatInMeasure * 8) / 8;
          const beatKey = Math.round(quantizedBeat * 1000);
          if (!noteGroups.has(beatKey)) {
            noteGroups.set(beatKey, []);
          }
          noteGroups.get(beatKey)!.push(note);
        }

        // Create VexFlow notes with ghost notes filling gaps (for spacing)
        const staveNotes: (StaveNote | GhostNote)[] = [];
        const noteTimings: {
          startTime: number;
          endTime: number;
          staveNoteIndex: number;
        }[] = [];
        const sortedBeatKeys = [...noteGroups.keys()].sort((a, b) => a - b);
        const trackColor = hexToRgb(track.color);

        let currentBeat = 0;

        for (const beatKey of sortedBeatKeys) {
          const noteBeat = beatKey / 1000;
          const notes = noteGroups.get(beatKey)!;

          if (noteBeat >= quarterNotesPerMeasure) continue;

          // Add invisible ghost notes to fill gap before this note (for proper spacing)
          const gap = noteBeat - currentBeat;
          if (gap >= 0.125) {
            const restDurations = generateRests(gap);
            for (const restDur of restDurations) {
              try {
                // Use GhostNote instead of visible rest - takes up space but doesn't render
                const ghostNote = new GhostNote({ duration: restDur.replace('r', '') });
                staveNotes.push(ghostNote);
              } catch {
                // Skip notes that can't be created
              }
            }
          }

          // Create the actual note(s)
          const keys: string[] = [];
          const accidentals: (string | undefined)[] = [];

          for (const note of notes) {
            const { key, accidental } = midiToVexFlow(note.noteNumber, keyNum);
            keys.push(key);
            accidentals.push(accidental);
          }

          const remainingInMeasure = quarterNotesPerMeasure - noteBeat;
          const rawDuration = getDuration(notes[0].duration, bpm);
          const rawDurationBeats = durationToBeats(rawDuration);
          const clampedBeats = Math.min(rawDurationBeats, remainingInMeasure);
          const duration = beatsToDuration(clampedBeats);
          const maxDuration = Math.max(...notes.map((n) => n.duration));

          try {
            const staveNote = new StaveNote({
              keys,
              duration,
              clef,
              autoStem: true, // Automatically flip stems based on note position
            });

            staveNote.setStyle({
              fillStyle: trackColor,
              strokeStyle: trackColor,
            });

            accidentals.forEach((acc, i) => {
              if (acc) {
                staveNote.addModifier(new Accidental(acc), i);
              }
            });

            staveNotes.push(staveNote);
            noteTimings.push({
              startTime: notes[0].startTime,
              endTime: notes[0].startTime + maxDuration,
              staveNoteIndex: staveNotes.length - 1,
            });

            currentBeat = noteBeat + durationToBeats(duration);
          } catch {
            // Skip notes that can't be rendered
          }
        }

        // Add trailing rests to fill measure
        if (currentBeat < quarterNotesPerMeasure) {
          const gap = quarterNotesPerMeasure - currentBeat;
          if (gap >= 0.125) {
            const restDurations = generateRests(gap);
            for (const restDur of restDurations) {
              try {
                // Use GhostNote instead of visible rest - takes up space but doesn't render
                const ghostNote = new GhostNote({ duration: restDur.replace('r', '') });
                staveNotes.push(ghostNote);
              } catch {
                // Skip notes that can't be created
              }
            }
          }
        }

        if (staveNotes.length === 0) return;

        // Create voice
        const voice = new Voice({
          numBeats: beatsPerMeasure,
          beatValue,
        }).setStrict(false);
        voice.addTickables(staveNotes);
        voices.push(voice);
        voiceData.push({ voice, stave, staveNotes, noteTimings });
      });

      // Format all voices together for alignment
      if (voices.length > 0) {
        try {
          const noteStartX = staves[0].getNoteStartX();
          const noteEndX = staves[0].getNoteEndX();
          const usableWidth = noteEndX - noteStartX;

          const formatter = new Formatter({ softmaxFactor: 50 });
          // Don't joinVoices - that's for same-stave voices
          // Just format all voices together for cross-stave alignment
          voices.forEach((v) => formatter.joinVoices([v]));
          formatter.format(voices, usableWidth);

          // Draw all voices with beams
          voiceData.forEach(({ voice, stave, staveNotes, noteTimings }) => {
            // Generate beams for 8th notes and shorter, using time-signature-aware groupings
            const beamGroups = getBeamGroupsForTimeSignature(beatsPerMeasure, beatValue);
            const beams = Beam.generateBeams(staveNotes, {
              groups: beamGroups,
              maintainStemDirections: true,
            });

            voice.draw(context, stave);

            // Draw beams
            beams.forEach((beam) => beam.setContext(context).draw());

            // Extract note positions using note head X position (not bounding box which includes accidentals)
            noteTimings.forEach((timing) => {
              try {
                const staveNote = staveNotes[timing.staveNoteIndex];
                const noteX = staveNote.getAbsoluteX();
                const bb = staveNote.getBoundingBox();
                if (bb) {
                  notePositions.push({
                    x: noteX,
                    y: bb.getY(),
                    width: 20, // Fixed width for note head
                    height: bb.getH(),
                    startTime: timing.startTime,
                    endTime: timing.endTime,
                  });
                }
              } catch {
                // Ignore position extraction errors
              }
            });
          });
        } catch {
          // Ignore formatting errors
        }
      }

      // Draw brace/connector for multiple tracks at start of each line
      if (posInLine === 0 && staves.length > 1) {
        try {
          const connector = new StaveConnector(
            staves[0],
            staves[staves.length - 1],
          );
          connector.setType('brace');
          connector.setContext(context).draw();

          const lineConnector = new StaveConnector(
            staves[0],
            staves[staves.length - 1],
          );
          lineConnector.setType('singleLeft');
          lineConnector.setContext(context).draw();
        } catch {
          // Ignore connector errors
        }
      }

      // Draw bar line connector at end of each measure
      if (staves.length > 1) {
        try {
          const endConnector = new StaveConnector(
            staves[0],
            staves[staves.length - 1],
          );
          endConnector.setType('singleRight');
          endConnector.setContext(context).draw();
        } catch {
          // Ignore connector errors
        }
      }
    }

    // Store note positions for highlighting
    notePositionsRef.current = notePositions;

    // Store layout info for progress tracking
    // Calculate seconds per measure: (seconds per quarter note) * (quarter notes per measure)
    const secondsPerMeasure = (60 / bpm) * beatsPerMeasure * (4 / beatValue);
    container.dataset.measureCount = String(measureCount);
    container.dataset.stavesPerLine = String(stavesPerLine);
    container.dataset.staveWidth = String(staveWidth);
    container.dataset.systemHeight = String(systemHeight);
    container.dataset.leftMargin = String(leftMargin);
    container.dataset.topMargin = String(topMargin);
    container.dataset.secondsPerMeasure = String(secondsPerMeasure);
    container.dataset.trackCount = String(enabledTracks.length);
    container.dataset.singleStaveHeight = String(singleStaveHeight);
  }, [currentFile, beatsPerMeasureProp, theme]);

  // Highlight active notes and auto-scroll
  useEffect(() => {
    const container = containerRef.current;
    const highlights = highlightsRef.current;
    if (!container || !highlights) return;

    let animationId: number;
    let lastScrollY = -1;

    const updateHighlights = () => {
      if (!currentFile) {
        animationId = requestAnimationFrame(updateHighlights);
        return;
      }

      const currentTime = getPlaybackTime();
      const notePositions = notePositionsRef.current;

      // Clear existing highlights
      highlights.innerHTML = '';

      // Find and highlight active notes
      let minY = Infinity;
      let maxY = 0;

      for (const pos of notePositions) {
        if (currentTime >= pos.startTime && currentTime < pos.endTime) {
          // Create highlight element
          const highlight = document.createElement('div');
          highlight.className = styles.noteHighlight;
          highlight.style.left = `${pos.x - 4}px`;
          highlight.style.top = `${pos.y - 4}px`;
          highlight.style.width = `${pos.width + 8}px`;
          highlight.style.height = `${pos.height + 8}px`;
          highlights.appendChild(highlight);

          // Track Y range for scrolling
          minY = Math.min(minY, pos.y);
          maxY = Math.max(maxY, pos.y + pos.height);
        }
      }

      // Auto-scroll to keep active notes visible
      if (minY !== Infinity) {
        const containerHeight = container.clientHeight;
        const scrollTarget = minY - containerHeight / 3;

        // Only scroll if we've moved to a different region
        if (Math.abs(scrollTarget - lastScrollY) > containerHeight * 0.3) {
          lastScrollY = scrollTarget;
          container.scrollTo({
            top: Math.max(0, scrollTarget),
            behavior: 'smooth',
          });
        }
      }

      animationId = requestAnimationFrame(updateHighlights);
    };

    animationId = requestAnimationFrame(updateHighlights);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [currentFile, getPlaybackTime, renderedHeight]);

  return (
    <div ref={containerRef} className={styles.container}>
      <div ref={svgContainerRef} className={styles.svgContainer}>
        <div ref={highlightsRef} className={styles.highlights} />
      </div>
    </div>
  );
}
