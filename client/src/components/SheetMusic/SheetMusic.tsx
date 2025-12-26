import { useEffect, useRef, useState, useCallback } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter, Accidental } from 'vexflow';
import { useMidiStore } from '../../stores/midiStore';
import type { MidiNote } from '../../types/midi';
import styles from './SheetMusic.module.css';

interface SheetMusicProps {
  /** Beats per measure */
  beatsPerMeasure?: number;
}

/** Convert MIDI note number to VexFlow note name */
function midiToVexFlow(noteNumber: number): { key: string; accidental?: string } {
  const noteNames = ['c', 'c', 'd', 'd', 'e', 'f', 'f', 'g', 'g', 'a', 'a', 'b'];
  const accidentals = [null, '#', null, '#', null, null, '#', null, '#', null, '#', null];
  const octave = Math.floor(noteNumber / 12) - 1;
  const noteIndex = noteNumber % 12;
  const noteName = noteNames[noteIndex];
  const accidental = accidentals[noteIndex];

  return {
    key: `${noteName}/${octave}`,
    accidental: accidental || undefined,
  };
}

/** Get note duration string for VexFlow */
function getDuration(durationSeconds: number, bpm: number): string {
  const beatsPerSecond = bpm / 60;
  const beats = durationSeconds * beatsPerSecond;

  if (beats >= 3.5) return 'w';      // whole
  if (beats >= 1.75) return 'h';     // half
  if (beats >= 0.875) return 'q';    // quarter
  if (beats >= 0.4375) return '8';   // eighth
  if (beats >= 0.21875) return '16'; // sixteenth
  return '32';                        // thirty-second
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
  const secondsPerMeasure = (60 / bpm) * beatsPerMeasure;
  const measureCount = Math.ceil(duration / secondsPerMeasure);
  const measures: Measure[] = [];

  for (let i = 0; i < measureCount; i++) {
    const startTime = i * secondsPerMeasure;
    const endTime = (i + 1) * secondsPerMeasure;
    const measureNotes = notes.filter(
      (n) => n.startTime >= startTime && n.startTime < endTime
    );
    measures.push({ startTime, endTime, notes: measureNotes });
  }

  return measures;
}

export function SheetMusic({ beatsPerMeasure = 4 }: SheetMusicProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const progressLineRef = useRef<HTMLDivElement>(null);
  const [renderedHeight, setRenderedHeight] = useState(0);

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
      container.innerHTML = '';
      return;
    }

    // Clear previous render
    container.innerHTML = '';

    // Get all enabled notes
    const allNotes: MidiNote[] = [];
    for (const track of file.tracks) {
      if (track.enabled) {
        allNotes.push(...track.notes);
      }
    }

    if (allNotes.length === 0) {
      setRenderedHeight(0);
      return;
    }

    // Sort by start time
    allNotes.sort((a, b) => a.startTime - b.startTime);

    // Get tempo (use first tempo or default)
    const bpm = file.tempos.length > 0 ? file.tempos[0].bpm : 120;

    // Group into measures
    const measures = groupNotesIntoMeasures(allNotes, file.duration, bpm, beatsPerMeasure);

    // Layout constants
    const staveWidth = 300;
    const stavesPerLine = 4;
    const staveHeight = 150;
    const leftMargin = 10;
    const topMargin = 40;
    const lineCount = Math.ceil(measures.length / stavesPerLine);
    const totalHeight = lineCount * staveHeight + topMargin * 2;

    setRenderedHeight(totalHeight);

    // Create renderer
    const renderer = new Renderer(container, Renderer.Backends.SVG);
    renderer.resize(stavesPerLine * staveWidth + leftMargin * 2, totalHeight);
    const context = renderer.getContext();
    context.setFont('Arial', 10);

    // Render each measure
    measures.forEach((measure, measureIndex) => {
      const lineIndex = Math.floor(measureIndex / stavesPerLine);
      const posInLine = measureIndex % stavesPerLine;
      const x = leftMargin + posInLine * staveWidth;
      const y = topMargin + lineIndex * staveHeight;

      // Create stave
      const stave = new Stave(x, y, staveWidth);
      if (posInLine === 0) {
        stave.addClef('treble');
        stave.addTimeSignature(`${beatsPerMeasure}/4`);
      }
      stave.setContext(context).draw();

      // Skip empty measures but draw the stave
      if (measure.notes.length === 0) {
        // Draw a whole rest
        try {
          const restNote = new StaveNote({
            keys: ['b/4'],
            duration: 'wr', // whole rest
          });
          const voice = new Voice({ numBeats: beatsPerMeasure, beatValue: 4 }).setStrict(false);
          voice.addTickables([restNote]);
          new Formatter().joinVoices([voice]).format([voice], staveWidth - 50);
          voice.draw(context, stave);
        } catch {
          // Ignore formatting errors for rests
        }
        return;
      }

      // Group simultaneous notes (chords)
      const noteGroups: Map<number, MidiNote[]> = new Map();
      for (const note of measure.notes) {
        const timeKey = Math.round(note.startTime * 1000); // ms precision
        if (!noteGroups.has(timeKey)) {
          noteGroups.set(timeKey, []);
        }
        noteGroups.get(timeKey)!.push(note);
      }

      // Create VexFlow notes
      const staveNotes: StaveNote[] = [];
      const sortedTimes = [...noteGroups.keys()].sort((a, b) => a - b);

      for (const timeKey of sortedTimes) {
        const notes = noteGroups.get(timeKey)!;
        const keys: string[] = [];
        const accidentals: (string | undefined)[] = [];

        for (const note of notes) {
          const { key, accidental } = midiToVexFlow(note.noteNumber);
          keys.push(key);
          accidentals.push(accidental);
        }

        // Use the first note's duration for the chord
        const duration = getDuration(notes[0].duration, bpm);

        try {
          const staveNote = new StaveNote({
            keys,
            duration,
          });

          // Add accidentals
          accidentals.forEach((acc, i) => {
            if (acc) {
              staveNote.addModifier(new Accidental(acc), i);
            }
          });

          staveNotes.push(staveNote);
        } catch {
          // Skip notes that can't be rendered
        }
      }

      if (staveNotes.length === 0) return;

      // Create voice and format
      try {
        const voice = new Voice({ numBeats: beatsPerMeasure, beatValue: 4 }).setStrict(false);
        voice.addTickables(staveNotes);
        new Formatter().joinVoices([voice]).format([voice], staveWidth - 50);
        voice.draw(context, stave);
      } catch {
        // Ignore formatting errors
      }
    });

    // Store measure info for progress tracking
    container.dataset.measureCount = String(measures.length);
    container.dataset.stavesPerLine = String(stavesPerLine);
    container.dataset.staveWidth = String(staveWidth);
    container.dataset.staveHeight = String(staveHeight);
    container.dataset.leftMargin = String(leftMargin);
    container.dataset.topMargin = String(topMargin);
    container.dataset.duration = String(file.duration);
  }, [getCurrentFile, beatsPerMeasure]);

  // Update progress line and scroll
  useEffect(() => {
    const container = containerRef.current;
    const svgContainer = svgContainerRef.current;
    const progressLine = progressLineRef.current;
    if (!container || !svgContainer || !progressLine) return;

    let animationId: number;

    const updateProgress = () => {
      const file = getCurrentFile();
      if (!file) {
        animationId = requestAnimationFrame(updateProgress);
        return;
      }

      const currentTime = getPlaybackTime();
      const duration = parseFloat(svgContainer.dataset.duration || '0');
      const measureCount = parseInt(svgContainer.dataset.measureCount || '0');
      const stavesPerLine = parseInt(svgContainer.dataset.stavesPerLine || '4');
      const staveWidth = parseInt(svgContainer.dataset.staveWidth || '300');
      const staveHeight = parseInt(svgContainer.dataset.staveHeight || '150');
      const leftMargin = parseInt(svgContainer.dataset.leftMargin || '10');
      const topMargin = parseInt(svgContainer.dataset.topMargin || '40');

      if (duration === 0 || measureCount === 0) {
        animationId = requestAnimationFrame(updateProgress);
        return;
      }

      // Calculate which measure we're in
      const progress = currentTime / duration;
      const currentMeasure = Math.floor(progress * measureCount);
      const measureProgress = (progress * measureCount) % 1;

      // Calculate position
      const lineIndex = Math.floor(currentMeasure / stavesPerLine);
      const posInLine = currentMeasure % stavesPerLine;
      const x = leftMargin + posInLine * staveWidth + measureProgress * staveWidth;
      const y = topMargin + lineIndex * staveHeight;

      // Update progress line
      progressLine.style.left = `${x}px`;
      progressLine.style.top = `${y}px`;
      progressLine.style.height = `${staveHeight - 20}px`;

      // Auto-scroll to keep progress line visible
      const containerHeight = container.clientHeight;
      const scrollTarget = y - containerHeight / 3;

      if (scrollTarget > container.scrollTop + containerHeight * 0.5 ||
          scrollTarget < container.scrollTop - containerHeight * 0.2) {
        container.scrollTo({
          top: Math.max(0, scrollTarget),
          behavior: 'smooth',
        });
      }

      animationId = requestAnimationFrame(updateProgress);
    };

    animationId = requestAnimationFrame(updateProgress);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [getCurrentFile, getPlaybackTime, renderedHeight]);

  return (
    <div ref={containerRef} className={styles.container}>
      <div ref={svgContainerRef} className={styles.svgContainer} />
      <div ref={progressLineRef} className={styles.progressLine} />
    </div>
  );
}
