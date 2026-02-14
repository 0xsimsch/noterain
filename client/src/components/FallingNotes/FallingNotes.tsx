import { useEffect, useRef, useMemo } from 'react';
import { useMidiStore } from '../../stores/midiStore';
import { PIANO_MIN_NOTE, PIANO_MAX_NOTE } from '../../types/midi';
import { FallingNotesRenderer } from './FallingNotesRenderer';

interface FallingNotesProps {
  /** How many seconds of notes to show ahead */
  lookahead?: number;
  /** Minimum note to render (default: PIANO_MIN_NOTE) */
  minNote?: number;
  /** Maximum note to render (default: PIANO_MAX_NOTE) */
  maxNote?: number;
}

export function FallingNotes({
  lookahead = 3,
  minNote = PIANO_MIN_NOTE,
  maxNote = PIANO_MAX_NOTE,
}: FallingNotesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<FallingNotesRenderer | null>(null);
  const { settings } = useMidiStore();
  const seek = useMidiStore((s) => s.seek);
  const currentFileId = useMidiStore((s) => s.currentFileId);
  const files = useMidiStore((s) => s.files);

  const currentFile = useMemo(
    () => files.find((f) => f.id === currentFileId) || null,
    [files, currentFileId],
  );

  // Init / destroy renderer
  useEffect(() => {
    const renderer = new FallingNotesRenderer(containerRef.current!, { seek });
    rendererRef.current = renderer;
    renderer.init();
    return () => renderer.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Forward prop / state changes
  useEffect(() => rendererRef.current?.setNoteRange(minNote, maxNote), [minNote, maxNote]);
  useEffect(() => rendererRef.current?.setTheme(settings.theme), [settings.theme]);
  useEffect(
    () =>
      rendererRef.current?.setColorSettings(
        settings.noteColorMode,
        settings.leftHandColor,
        settings.rightHandColor,
      ),
    [settings.noteColorMode, settings.leftHandColor, settings.rightHandColor],
  );
  useEffect(() => rendererRef.current?.setFile(currentFile), [currentFile]);
  useEffect(() => rendererRef.current?.setLookahead(lookahead), [lookahead]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: 'var(--canvas-bg)',
      }}
    />
  );
}
