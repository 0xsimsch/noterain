import { useEffect, useRef, useMemo } from 'react';
import {
  Renderer,
  Stave,
  StaveNote,
  Voice,
  Formatter,
  Accidental,
} from 'vexflow';
import { useMidiStore } from '../../stores/midiStore';
import styles from './NotesOverlay.module.css';

const OVERLAY_WIDTH = 130;
const OVERLAY_HEIGHT = 150;
const STAVE_WIDTH = OVERLAY_WIDTH - 20;
/** Chord patterns defined by intervals from root */
const CHORD_PATTERNS: { name: string; intervals: number[]; suffix: string }[] =
  [
    // Major chords
    { name: 'Major', intervals: [0, 4, 7], suffix: '' },
    { name: 'Major 7', intervals: [0, 4, 7, 11], suffix: 'maj7' },
    { name: 'Dominant 7', intervals: [0, 4, 7, 10], suffix: '7' },
    { name: 'Add 9', intervals: [0, 4, 7, 14], suffix: 'add9' },
    { name: 'Major 9', intervals: [0, 4, 7, 11, 14], suffix: 'maj9' },
    { name: '6', intervals: [0, 4, 7, 9], suffix: '6' },

    // Minor chords
    { name: 'Minor', intervals: [0, 3, 7], suffix: 'm' },
    { name: 'Minor 7', intervals: [0, 3, 7, 10], suffix: 'm7' },
    { name: 'Minor Major 7', intervals: [0, 3, 7, 11], suffix: 'mMaj7' },
    { name: 'Minor 9', intervals: [0, 3, 7, 10, 14], suffix: 'm9' },
    { name: 'Minor 6', intervals: [0, 3, 7, 9], suffix: 'm6' },

    // Diminished
    { name: 'Diminished', intervals: [0, 3, 6], suffix: 'dim' },
    { name: 'Diminished 7', intervals: [0, 3, 6, 9], suffix: 'dim7' },
    { name: 'Half Diminished', intervals: [0, 3, 6, 10], suffix: 'm7b5' },

    // Augmented
    { name: 'Augmented', intervals: [0, 4, 8], suffix: 'aug' },
    { name: 'Augmented 7', intervals: [0, 4, 8, 10], suffix: 'aug7' },

    // Suspended
    { name: 'Sus4', intervals: [0, 5, 7], suffix: 'sus4' },
    { name: 'Sus2', intervals: [0, 2, 7], suffix: 'sus2' },
    { name: '7sus4', intervals: [0, 5, 7, 10], suffix: '7sus4' },

    // Power chord
    { name: 'Power', intervals: [0, 7], suffix: '5' },
  ];

const NOTE_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
];
/** Detect chord from a set of MIDI note numbers */
function detectChord(
  noteNumbers: number[],
): { root: string; suffix: string } | null {
  if (noteNumbers.length < 2) return null;

  // Get unique pitch classes
  const pitchClasses = [...new Set(noteNumbers.map((n) => n % 12))].sort(
    (a, b) => a - b,
  );
  if (pitchClasses.length < 2) return null;

  // Try each pitch class as potential root
  for (const rootPc of pitchClasses) {
    // Calculate intervals relative to this root
    const intervals = pitchClasses
      .map((pc) => (pc - rootPc + 12) % 12)
      .sort((a, b) => a - b);

    // Try to match against known patterns
    for (const pattern of CHORD_PATTERNS) {
      if (matchesPattern(intervals, pattern.intervals)) {
        const rootName = NOTE_NAMES[rootPc];
        return { root: rootName, suffix: pattern.suffix };
      }
    }
  }

  // Try inversions (allow any note to be the root)
  for (let i = 0; i < pitchClasses.length; i++) {
    const rootPc = pitchClasses[i];
    const intervals = pitchClasses
      .map((pc) => (pc - rootPc + 12) % 12)
      .sort((a, b) => a - b);

    for (const pattern of CHORD_PATTERNS) {
      if (matchesPattern(intervals, pattern.intervals)) {
        const rootName = NOTE_NAMES[rootPc];
        const bassNote = NOTE_NAMES[pitchClasses[0]];
        if (bassNote !== rootName) {
          return { root: rootName, suffix: `${pattern.suffix}/${bassNote}` };
        }
        return { root: rootName, suffix: pattern.suffix };
      }
    }
  }

  return null;
}

/** Check if intervals match a pattern (allowing for octave duplications) */
function matchesPattern(intervals: number[], pattern: number[]): boolean {
  // Normalize intervals to single octave for comparison
  const normalizedIntervals = [...new Set(intervals.map((i) => i % 12))].sort(
    (a, b) => a - b,
  );
  const normalizedPattern = [...new Set(pattern.map((i) => i % 12))].sort(
    (a, b) => a - b,
  );

  // Check if all pattern intervals are present
  if (normalizedPattern.length !== normalizedIntervals.length) return false;
  return normalizedPattern.every((p, i) => normalizedIntervals[i] === p);
}

/** Convert MIDI note number to VexFlow key */
function midiToVexKey(noteNumber: number): {
  key: string;
  accidental?: string;
} {
  const octave = Math.floor(noteNumber / 12) - 1;
  const pc = noteNumber % 12;

  const names = ['c', 'c', 'd', 'd', 'e', 'f', 'f', 'g', 'g', 'a', 'a', 'b'];
  const needsSharp = [
    false,
    true,
    false,
    true,
    false,
    false,
    true,
    false,
    true,
    false,
    true,
    false,
  ];

  return {
    key: `${names[pc]}/${octave}`,
    accidental: needsSharp[pc] ? '#' : undefined,
  };
}

export function NotesOverlay() {
  const trebleRef = useRef<HTMLDivElement>(null);
  const bassRef = useRef<HTMLDivElement>(null);

  const { liveNotes, playback, settings } = useMidiStore();

  // Combine live notes with active playback notes
  const allNotes = useMemo(() => {
    const combined = new Set<number>();
    liveNotes.forEach((n) => combined.add(n));
    playback.activeNotes.forEach((n) => combined.add(n));
    return [...combined].sort((a, b) => a - b);
  }, [liveNotes, playback.activeNotes]);

  // Detect chord
  const chord = useMemo(() => detectChord(allNotes), [allNotes]);

  // Split notes into treble and bass clef (middle C = 60 is C4)
  const { trebleNotes, bassNotes } = useMemo(() => {
    const treble: number[] = [];
    const bass: number[] = [];

    for (const note of allNotes) {
      if (note >= 60) {
        treble.push(note);
      } else {
        bass.push(note);
      }
    }

    return { trebleNotes: treble, bassNotes: bass };
  }, [allNotes]);

  // Render treble clef
  useEffect(() => {
    if (!trebleRef.current) return;

    const container = trebleRef.current;
    container.innerHTML = '';

    const renderer = new Renderer(container, Renderer.Backends.SVG);
    renderer.resize(OVERLAY_WIDTH, OVERLAY_HEIGHT);
    const context = renderer.getContext();

    const stave = new Stave(10, 10, STAVE_WIDTH);
    stave.addClef('treble');

    // Apply theme colors
    const isDark = settings.theme === 'mocha';
    const noteColor = isDark ? '#cdd6f4' : '#4c4f69';
    const staveColor = isDark ? '#6c7086' : '#9ca0b0';

    // Set default context colors for clef rendering
    context.setStrokeStyle(staveColor);
    context.setFillStyle(staveColor);

    stave.setStyle({ strokeStyle: staveColor, fillStyle: staveColor });
    stave.setContext(context).draw();

    // Fix SVG overflow/viewBox issues
    const svg = container.querySelector('svg');
    if (svg) {
      svg.style.overflow = 'visible';
      svg.removeAttribute('viewBox');
    }

    if (trebleNotes.length > 0) {
      const keys = trebleNotes.map((n) => midiToVexKey(n));
      const staveNote = new StaveNote({
        keys: keys.map((k) => k.key),
        duration: 'w',
      });

      // Add accidentals
      keys.forEach((k, i) => {
        if (k.accidental) {
          staveNote.addModifier(new Accidental(k.accidental), i);
        }
      });

      staveNote.setStyle({ fillStyle: noteColor, strokeStyle: noteColor });

      const voice = new Voice({ numBeats: 4, beatValue: 4 }).setStrict(false);
      voice.addTickables([staveNote]);

      new Formatter().joinVoices([voice]).format([voice], 60);
      voice.draw(context, stave);
    }
  }, [trebleNotes, settings.theme]);

  // Render bass clef
  useEffect(() => {
    if (!bassRef.current) return;

    const container = bassRef.current;
    container.innerHTML = '';

    const renderer = new Renderer(container, Renderer.Backends.SVG);
    renderer.resize(OVERLAY_WIDTH, OVERLAY_HEIGHT);
    const context = renderer.getContext();

    const stave = new Stave(10, 10, STAVE_WIDTH);
    stave.addClef('bass');

    // Apply theme colors
    const isDark = settings.theme === 'mocha';
    const noteColor = isDark ? '#cdd6f4' : '#4c4f69';
    const staveColor = isDark ? '#6c7086' : '#9ca0b0';

    // Set default context colors for clef rendering
    context.setStrokeStyle(staveColor);
    context.setFillStyle(staveColor);

    stave.setStyle({ strokeStyle: staveColor, fillStyle: staveColor });
    stave.setContext(context).draw();

    // Fix SVG overflow/viewBox issues
    const svg = container.querySelector('svg');
    if (svg) {
      svg.style.overflow = 'visible';
      svg.removeAttribute('viewBox');
    }

    if (bassNotes.length > 0) {
      const keys = bassNotes.map((n) => midiToVexKey(n));
      const staveNote = new StaveNote({
        keys: keys.map((k) => k.key),
        duration: 'w',
        clef: 'bass',
      });

      // Add accidentals
      keys.forEach((k, i) => {
        if (k.accidental) {
          staveNote.addModifier(new Accidental(k.accidental), i);
        }
      });

      staveNote.setStyle({ fillStyle: noteColor, strokeStyle: noteColor });

      const voice = new Voice({ numBeats: 4, beatValue: 4 }).setStrict(false);
      voice.addTickables([staveNote]);

      new Formatter().joinVoices([voice]).format([voice], 60);
      voice.draw(context, stave);
    }
  }, [bassNotes, settings.theme]);

  // Format note names for display
  const noteNamesDisplay = useMemo(() => {
    if (allNotes.length === 0) return '';
    return allNotes
      .map((n) => {
        const octave = Math.floor(n / 12) - 1;
        const pc = n % 12;
        return `${NOTE_NAMES[pc]}${octave}`;
      })
      .join(' ');
  }, [allNotes]);

  return (
    <div className={styles.overlay}>
      <div className={styles.staves}>
        <div ref={trebleRef} className={styles.stave} />
        <div ref={bassRef} className={styles.stave} />
      </div>
      <div className={styles.info}>
        {chord && (
          <div className={styles.chord}>
            <span className={styles.chordRoot}>{chord.root}</span>
            <span className={styles.chordSuffix}>{chord.suffix}</span>
          </div>
        )}
        {!chord && allNotes.length > 0 && (
          <div className={styles.notes}>{noteNamesDisplay}</div>
        )}
      </div>
    </div>
  );
}
