import { useMemo } from 'react';
import { useMidiStore } from '../../stores/midiStore';
import {
  PIANO_MIN_NOTE,
  PIANO_MAX_NOTE,
  isBlackKey,
  getNoteNameFromNumber,
} from '../../types/midi';
import styles from './PianoKeyboard.module.css';

interface PianoKeyboardProps {
  /** Which notes to highlight as active (from playback) */
  activeNotes?: Set<number>;
  /** Callback when a key is pressed (mouse/touch) */
  onNoteOn?: (noteNumber: number) => void;
  /** Callback when a key is released */
  onNoteOff?: (noteNumber: number) => void;
  /** Minimum note to render (default: PIANO_MIN_NOTE) */
  minNote?: number;
  /** Maximum note to render (default: PIANO_MAX_NOTE) */
  maxNote?: number;
}

/** Get the position of a key (0-1 range relative to keyboard width) */
function getKeyPosition(
  noteNumber: number,
  minNote: number,
  maxNote: number
): { left: number; width: number } {
  // Count white keys from start of range
  let whiteKeyIndex = 0;
  for (let n = minNote; n < noteNumber; n++) {
    if (!isBlackKey(n)) whiteKeyIndex++;
  }

  // Total white keys in range
  let totalWhiteKeys = 0;
  for (let n = minNote; n <= maxNote; n++) {
    if (!isBlackKey(n)) totalWhiteKeys++;
  }

  const whiteKeyWidth = 1 / totalWhiteKeys;
  const blackKeyWidth = whiteKeyWidth * 0.6;

  if (isBlackKey(noteNumber)) {
    // Black keys are positioned between white keys
    // They sit to the right of the previous white key
    const left = whiteKeyIndex * whiteKeyWidth - blackKeyWidth / 2;
    return { left, width: blackKeyWidth };
  } else {
    return { left: whiteKeyIndex * whiteKeyWidth, width: whiteKeyWidth };
  }
}

export function PianoKeyboard({
  activeNotes: propActiveNotes,
  onNoteOn,
  onNoteOff,
  minNote = PIANO_MIN_NOTE,
  maxNote = PIANO_MAX_NOTE,
}: PianoKeyboardProps) {
  const playbackActiveNotes = useMidiStore((s) => s.playback.activeNotes);
  const liveNotes = useMidiStore((s) => s.liveNotes);
  const settings = useMidiStore((s) => s.settings);

  // Combine playback active notes and live notes
  const activeNotes = useMemo(() => {
    const combined = new Set<number>();
    if (propActiveNotes) {
      propActiveNotes.forEach((n) => combined.add(n));
    }
    playbackActiveNotes.forEach((n) => combined.add(n));
    liveNotes.forEach((n) => combined.add(n));
    return combined;
  }, [propActiveNotes, playbackActiveNotes, liveNotes]);

  // Generate keys with positions
  const keys = useMemo(() => {
    const whiteKeys: Array<{
      noteNumber: number;
      noteName: string;
      position: { left: number; width: number };
    }> = [];
    const blackKeys: Array<{
      noteNumber: number;
      noteName: string;
      position: { left: number; width: number };
    }> = [];

    for (let note = minNote; note <= maxNote; note++) {
      const key = {
        noteNumber: note,
        noteName: getNoteNameFromNumber(note),
        position: getKeyPosition(note, minNote, maxNote),
      };

      if (isBlackKey(note)) {
        blackKeys.push(key);
      } else {
        whiteKeys.push(key);
      }
    }

    return { whiteKeys, blackKeys };
  }, [minNote, maxNote]);

  // Handle mouse/touch events
  const handleMouseDown = (noteNumber: number) => {
    onNoteOn?.(noteNumber);
  };

  const handleMouseUp = (noteNumber: number) => {
    onNoteOff?.(noteNumber);
  };

  // Get active color based on note (could be track-based in future)
  const getActiveColor = (noteNumber: number): string => {
    // Notes below middle C (60) are typically left hand
    if (noteNumber < 60) {
      return settings.leftHandColor;
    }
    return settings.rightHandColor;
  };

  const renderKey = (
    key: { noteNumber: number; noteName: string; position: { left: number; width: number } },
    isBlack: boolean
  ) => {
    const isActive = activeNotes.has(key.noteNumber);
    const isLive = liveNotes.has(key.noteNumber);

    return (
      <div
        key={key.noteNumber}
        className={`${styles.key} ${isBlack ? styles.black : styles.white} ${
          isActive ? styles.active : ''
        } ${isLive ? styles.live : ''}`}
        style={{
          left: `${key.position.left * 100}%`,
          width: `${key.position.width * 100}%`,
          ...(isActive ? { backgroundColor: getActiveColor(key.noteNumber) } : {}),
        }}
        onMouseDown={() => handleMouseDown(key.noteNumber)}
        onMouseUp={() => handleMouseUp(key.noteNumber)}
        onMouseLeave={() => handleMouseUp(key.noteNumber)}
        onTouchStart={(e) => {
          e.preventDefault();
          handleMouseDown(key.noteNumber);
        }}
        onTouchEnd={() => handleMouseUp(key.noteNumber)}
        data-note={key.noteName}
      >
        <span className={isBlack ? styles.blackLabel : styles.label}>
          {key.noteName.replace(/\d+$/, '')}
        </span>
      </div>
    );
  };

  return (
    <div className={styles.keyboard}>
      <div className={styles.keysContainer}>
        {/* White keys first (lower z-index) */}
        {keys.whiteKeys.map((key) => renderKey(key, false))}
        {/* Black keys on top */}
        {keys.blackKeys.map((key) => renderKey(key, true))}
      </div>
    </div>
  );
}
