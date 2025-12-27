import { useEffect, useRef, useState, useCallback } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter, Accidental, StaveConnector } from 'vexflow';
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
    '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F',
    '0': 'C',
    '1': 'G', '2': 'D', '3': 'A', '4': 'E', '5': 'B', '6': 'F#', '7': 'C#',
  };
  // Minor keys (relative minor)
  const minorKeys: Record<string, string> = {
    '-7': 'Ab', '-6': 'Eb', '-5': 'Bb', '-4': 'F', '-3': 'C', '-2': 'G', '-1': 'D',
    '0': 'A',
    '1': 'E', '2': 'B', '3': 'F#', '4': 'C#', '5': 'G#', '6': 'D#', '7': 'A#',
  };

  const keyMap = scale === 1 ? minorKeys : majorKeys;
  return keyMap[String(key)] || 'C';
}

/** Get which pitch classes have sharps/flats for a given MIDI key signature */
function getKeySignatureAlterations(key: number): { sharps: Set<number>; flats: Set<number> } {
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
function midiToVexFlow(noteNumber: number, keyNum: number): { key: string; accidental?: string } {
  const octave = Math.floor(noteNumber / 12) - 1;
  const pc = noteNumber % 12;

  const { sharps, flats } = getKeySignatureAlterations(keyNum);

  // Pitch classes: C=0, C#=1, D=2, D#=3, E=4, F=5, F#=6, G=7, G#=8, A=9, A#=10, B=11
  const naturalNames = ['c', 'c', 'd', 'd', 'e', 'f', 'f', 'g', 'g', 'a', 'a', 'b'];
  const isBlackKey = [1, 3, 6, 8, 10].includes(pc);

  let noteName = naturalNames[pc];
  let accidental: string | undefined;

  if (isBlackKey) {
    if (sharps.has(pc)) {
      // In key signature as sharp - no accidental needed
      accidental = undefined;
    } else if (flats.has(pc)) {
      // In key signature as flat - use flat note name, no accidental
      const flatNames = ['c', 'd', 'd', 'e', 'e', 'f', 'g', 'g', 'a', 'a', 'b', 'b'];
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
  if (beats >= 3.5) return 'w';      // whole (4 beats)
  if (beats >= 1.75) return 'h';     // half (2 beats)
  if (beats >= 0.875) return 'q';    // quarter (1 beat)
  if (beats >= 0.4375) return '8';   // eighth (0.5 beats)
  if (beats >= 0.21875) return '16'; // sixteenth (0.25 beats)
  return '32';                        // thirty-second (0.125 beats)
}

/** Get the beat value for a VexFlow duration */
function durationToBeats(duration: string): number {
  switch (duration) {
    case 'w': return 4;
    case 'h': return 2;
    case 'q': return 1;
    case '8': return 0.5;
    case '16': return 0.25;
    case '32': return 0.125;
    default: return 1;
  }
}

/** Generate rests to fill a gap of specified beats */
function generateRests(beats: number): string[] {
  const rests: string[] = [];
  let remaining = beats;

  const restValues: [string, number][] = [
    ['h', 2],      // half
    ['q', 1],      // quarter
    ['8', 0.5],    // eighth
    ['16', 0.25],  // sixteenth
    ['32', 0.125], // thirty-second
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

/** Get note duration string for VexFlow */
function getDuration(durationSeconds: number, bpm: number): string {
  const beatsPerSecond = bpm / 60;
  const beats = durationSeconds * beatsPerSecond;
  return beatsToDuration(beats);
}

/** Determine clef based on average note pitch */
function getClefForTrack(notes: MidiNote[]): 'treble' | 'bass' {
  if (notes.length === 0) return 'treble';
  const avgNote = notes.reduce((sum, n) => sum + n.noteNumber, 0) / notes.length;
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
  beatsPerMeasure: number
): Measure[] {
  // Use quarter note as the base beat (MIDI BPM is always quarter notes)
  const secondsPerBeat = 60 / bpm;
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
      const quantizedTime = Math.round(n.startTime / quantizeGrid) * quantizeGrid;
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

export function SheetMusic({ beatsPerMeasure: beatsPerMeasureProp }: SheetMusicProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const highlightsRef = useRef<HTMLDivElement>(null);
  const [renderedHeight, setRenderedHeight] = useState(0);

  // Store note positions for highlighting
  const notePositionsRef = useRef<NotePosition[]>([]);

  // Use getState for values that change frequently
  const getCurrentFile = useCallback(() => {
    const state = useMidiStore.getState();
    return state.files.find((f) => f.id === state.currentFileId) || null;
  }, []);

  const getPlaybackTime = useCallback(() => {
    return useMidiStore.getState().playback.currentTime;
  }, []);

  // Render sheet music
  useEffect(() => {
    const container = svgContainerRef.current;
    if (!container) return;

    const file = getCurrentFile();
    if (!file || file.tracks.length === 0) {
      const existingSvg = container.querySelector('svg');
      if (existingSvg) existingSvg.remove();
      return;
    }

    // Clear previous SVG (but keep progress line)
    const existingSvg = container.querySelector('svg');
    if (existingSvg) existingSvg.remove();

    // Get enabled tracks with notes
    const enabledTracks = file.tracks.filter(t => t.enabled && t.notes.length > 0);

    if (enabledTracks.length === 0) {
      setRenderedHeight(0);
      return;
    }

    // Get tempo (use first tempo or default)
    const bpm = file.tempos.length > 0 ? file.tempos[0].bpm : 120;

    // Get time signature from file or use prop override (default to 4/4)
    const beatsPerMeasure = beatsPerMeasureProp ?? 4;
    const beatValue = 4;

    // Get key signature from file, or detect from notes if not present
    const allNotes = enabledTracks.flatMap(t => t.notes);
    const fileKeyNum = file.keySignature?.key ?? 0;
    const keyNum = fileKeyNum !== 0 ? fileKeyNum : detectKeySignature(allNotes);
    const keyScale = file.keySignature?.scale ?? 0;
    const vexFlowKey = midiKeyToVexFlow(keyNum, keyScale);

    // Group each track's notes into measures
    const trackMeasures: { track: MidiTrack; measures: Measure[]; clef: 'treble' | 'bass' }[] =
      enabledTracks.map(track => ({
        track,
        measures: groupNotesIntoMeasures(track.notes, file.duration, bpm, beatsPerMeasure),
        clef: getClefForTrack(track.notes),
      }));

    // Layout constants
    const staveWidth = 600;  // Wider staves for better proportional spacing
    const stavesPerLine = 2; // Fewer measures per line = more space
    const singleStaveHeight = 80;
    const trackSpacing = 20; // Space between track groups
    const leftMargin = 10;
    const topMargin = 40;

    // Height for one "system" (all tracks for one set of measures)
    const systemHeight = enabledTracks.length * singleStaveHeight + trackSpacing;

    const measureCount = trackMeasures[0]?.measures.length || 0;
    const lineCount = Math.ceil(measureCount / stavesPerLine);
    const totalHeight = lineCount * systemHeight + topMargin * 2;

    setRenderedHeight(totalHeight);

    // Create renderer
    const renderer = new Renderer(container, Renderer.Backends.SVG);
    renderer.resize(stavesPerLine * staveWidth + leftMargin * 2, totalHeight);
    const context = renderer.getContext();
    context.setFont('Arial', 10);

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
      const voiceData: { voice: Voice; stave: Stave; staveNotes: StaveNote[]; noteTimings: { startTime: number; endTime: number; staveNoteIndex: number }[] }[] = [];

      // First pass: create all staves and voices
      trackMeasures.forEach(({ track, measures, clef }, trackIndex) => {
        const y = baseY + trackIndex * singleStaveHeight;
        const measure = measures[measureIndex];

        // Create stave
        const stave = new Stave(x, y, staveWidth);
        if (posInLine === 0) {
          stave.addClef(clef);
          stave.addKeySignature(vexFlowKey);
          stave.addTimeSignature(`${beatsPerMeasure}/${beatValue}`);
        }
        stave.setContext(context).draw();
        staves.push(stave);

        // Skip empty measures
        if (!measure || measure.notes.length === 0) {
          return;
        }

        // Group simultaneous notes (chords) by their beat position
        const secondsPerBeat = 60 / bpm;
        const noteGroups: Map<number, MidiNote[]> = new Map();
        for (const note of measure.notes) {
          const beatInMeasure = (note.startTime - measure.startTime) / secondsPerBeat;
          const quantizedBeat = Math.round(beatInMeasure * 8) / 8;
          const beatKey = Math.round(quantizedBeat * 1000);
          if (!noteGroups.has(beatKey)) {
            noteGroups.set(beatKey, []);
          }
          noteGroups.get(beatKey)!.push(note);
        }

        // Create VexFlow notes with rests filling gaps
        const staveNotes: StaveNote[] = [];
        const noteTimings: { startTime: number; endTime: number; staveNoteIndex: number }[] = [];
        const sortedBeatKeys = [...noteGroups.keys()].sort((a, b) => a - b);
        const trackColor = hexToRgb(track.color);

        let currentBeat = 0;

        for (const beatKey of sortedBeatKeys) {
          const noteBeat = beatKey / 1000;
          const notes = noteGroups.get(beatKey)!;

          if (noteBeat >= beatsPerMeasure) continue;

          // Add rests to fill gap before this note
          const gap = noteBeat - currentBeat;
          if (gap >= 0.125) {
            const restDurations = generateRests(gap);
            for (const restDur of restDurations) {
              try {
                const restNote = new StaveNote({
                  keys: [clef === 'bass' ? 'd/3' : 'b/4'],
                  duration: restDur,
                  clef,
                });
                staveNotes.push(restNote);
              } catch {
                // Skip rests that can't be rendered
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

          const remainingInMeasure = beatsPerMeasure - noteBeat;
          const rawDuration = getDuration(notes[0].duration, bpm);
          const rawDurationBeats = durationToBeats(rawDuration);
          const clampedBeats = Math.min(rawDurationBeats, remainingInMeasure);
          const duration = beatsToDuration(clampedBeats);
          const maxDuration = Math.max(...notes.map(n => n.duration));

          try {
            const staveNote = new StaveNote({
              keys,
              duration,
              clef,
            });

            staveNote.setStyle({ fillStyle: trackColor, strokeStyle: trackColor });

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
        if (currentBeat < beatsPerMeasure) {
          const gap = beatsPerMeasure - currentBeat;
          if (gap >= 0.125) {
            const restDurations = generateRests(gap);
            for (const restDur of restDurations) {
              try {
                const restNote = new StaveNote({
                  keys: [clef === 'bass' ? 'd/3' : 'b/4'],
                  duration: restDur,
                  clef,
                });
                staveNotes.push(restNote);
              } catch {
                // Skip rests that can't be rendered
              }
            }
          }
        }

        if (staveNotes.length === 0) return;

        // Create voice
        const voice = new Voice({ numBeats: beatsPerMeasure, beatValue }).setStrict(false);
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
          voices.forEach(v => formatter.joinVoices([v]));
          formatter.format(voices, usableWidth);

          // Draw all voices
          voiceData.forEach(({ voice, stave, staveNotes, noteTimings }) => {
            voice.draw(context, stave);

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
          const connector = new StaveConnector(staves[0], staves[staves.length - 1]);
          connector.setType('brace');
          connector.setContext(context).draw();

          const lineConnector = new StaveConnector(staves[0], staves[staves.length - 1]);
          lineConnector.setType('singleLeft');
          lineConnector.setContext(context).draw();
        } catch {
          // Ignore connector errors
        }
      }

      // Draw bar line connector at end of each measure
      if (staves.length > 1) {
        try {
          const endConnector = new StaveConnector(staves[0], staves[staves.length - 1]);
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
    const secondsPerMeasure = (60 / bpm) * beatsPerMeasure;
    container.dataset.measureCount = String(measureCount);
    container.dataset.stavesPerLine = String(stavesPerLine);
    container.dataset.staveWidth = String(staveWidth);
    container.dataset.systemHeight = String(systemHeight);
    container.dataset.leftMargin = String(leftMargin);
    container.dataset.topMargin = String(topMargin);
    container.dataset.secondsPerMeasure = String(secondsPerMeasure);
    container.dataset.trackCount = String(enabledTracks.length);
    container.dataset.singleStaveHeight = String(singleStaveHeight);
  }, [getCurrentFile, beatsPerMeasureProp]);

  // Highlight active notes and auto-scroll
  useEffect(() => {
    const container = containerRef.current;
    const highlights = highlightsRef.current;
    if (!container || !highlights) return;

    let animationId: number;
    let lastScrollY = -1;

    const updateHighlights = () => {
      const file = getCurrentFile();
      if (!file) {
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
  }, [getCurrentFile, getPlaybackTime, renderedHeight]);

  return (
    <div ref={containerRef} className={styles.container}>
      <div ref={svgContainerRef} className={styles.svgContainer}>
        <div ref={highlightsRef} className={styles.highlights} />
      </div>
    </div>
  );
}
