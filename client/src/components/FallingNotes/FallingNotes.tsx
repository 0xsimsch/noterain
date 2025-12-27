import { useEffect, useRef, useCallback, useState } from 'react';
import { Application, Graphics, Container } from 'pixi.js';
import { useMidiStore, getVisibleNotes } from '../../stores/midiStore';
import { PIANO_MIN_NOTE, PIANO_MAX_NOTE, isBlackKey } from '../../types/midi';

interface FallingNotesProps {
  /** How many seconds of notes to show ahead */
  lookahead?: number;
}

/** Get the X position for a note (0-1 range) */
function getNoteX(noteNumber: number): { x: number; width: number } {
  let whiteKeyIndex = 0;
  for (let n = PIANO_MIN_NOTE; n < noteNumber; n++) {
    if (!isBlackKey(n)) whiteKeyIndex++;
  }

  let totalWhiteKeys = 0;
  for (let n = PIANO_MIN_NOTE; n <= PIANO_MAX_NOTE; n++) {
    if (!isBlackKey(n)) totalWhiteKeys++;
  }

  const whiteKeyWidth = 1 / totalWhiteKeys;
  const blackKeyWidth = whiteKeyWidth * 0.6;

  if (isBlackKey(noteNumber)) {
    const x = whiteKeyIndex * whiteKeyWidth - blackKeyWidth / 2;
    return { x, width: blackKeyWidth };
  } else {
    return { x: whiteKeyIndex * whiteKeyWidth, width: whiteKeyWidth };
  }
}

/** Draw vertical grid lines for each piano key */
function drawGrid(app: Application, graphics: Graphics, theme: string) {
  const { width, height } = app.screen;
  if (width === 0 || height === 0) return;

  graphics.clear();

  const isLight = theme === 'latte';
  const lineColor = isLight ? 0x9ca0b0 : 0x45475a;
  const blackKeyBg = isLight ? 0xdce0e8 : 0x1e1e2e;

  // Draw background shading for black key lanes
  for (let note = PIANO_MIN_NOTE; note <= PIANO_MAX_NOTE; note++) {
    if (isBlackKey(note)) {
      const { x, width: noteWidth } = getNoteX(note);
      graphics.rect(x * width, 0, noteWidth * width, height).fill({ color: blackKeyBg, alpha: 0.5 });
    }
  }

  // Draw vertical lines at white key boundaries
  let whiteKeyIndex = 0;
  let totalWhiteKeys = 0;
  for (let n = PIANO_MIN_NOTE; n <= PIANO_MAX_NOTE; n++) {
    if (!isBlackKey(n)) totalWhiteKeys++;
  }

  const whiteKeyWidth = width / totalWhiteKeys;

  for (let note = PIANO_MIN_NOTE; note <= PIANO_MAX_NOTE; note++) {
    if (!isBlackKey(note)) {
      const x = whiteKeyIndex * whiteKeyWidth;
      graphics.moveTo(x, 0).lineTo(x, height).stroke({ color: lineColor, width: 1, alpha: 0.7 });
      whiteKeyIndex++;
    }
  }
}

export function FallingNotes({ lookahead = 3 }: FallingNotesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const notesContainerRef = useRef<Container | null>(null);
  const gridGraphicsRef = useRef<Graphics | null>(null);
  const noteGraphicsRef = useRef<Map<string, Graphics>>(new Map());
  const renderNotesRef = useRef<() => void>(() => {});
  const [isReady, setIsReady] = useState(false);

  const { settings } = useMidiStore();
  // Use getState() to read values inside animation loop without causing re-renders
  const getPlaybackTime = () => useMidiStore.getState().playback.currentTime;
  const getCurrentFile = () => {
    const state = useMidiStore.getState();
    return state.files.find((f) => f.id === state.currentFileId) || null;
  };

  // Initialize PixiJS
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Capture refs at effect start for cleanup
    const noteGraphics = noteGraphicsRef.current;
    let destroyed = false;
    const app = new Application();

    const initApp = async () => {
      try {
        // Get theme-appropriate background color
        const theme = useMidiStore.getState().settings.theme;
        const bgColor = theme === 'latte' ? 0xe6e9ef : 0x181825;

        await app.init({
          backgroundColor: bgColor,
          antialias: true,
          resolution: window.devicePixelRatio || 1,
          autoDensity: true,
          width: container.clientWidth,
          height: container.clientHeight,
        });

        // Check if component was unmounted during init
        if (destroyed) {
          app.destroy(true, { children: true });
          return;
        }

        // Style canvas to fit container exactly
        app.canvas.style.width = '100%';
        app.canvas.style.height = '100%';
        app.canvas.style.display = 'block';

        container.appendChild(app.canvas);
        appRef.current = app;

        // Create grid graphics (behind notes)
        const gridGraphics = new Graphics();
        app.stage.addChild(gridGraphics);
        gridGraphicsRef.current = gridGraphics;

        // Create notes container
        const notesContainer = new Container();
        app.stage.addChild(notesContainer);
        notesContainerRef.current = notesContainer;

        // Draw initial grid
        drawGrid(app, gridGraphics, theme);

        setIsReady(true);
      } catch (err) {
        console.error('Failed to initialize PixiJS:', err);
      }
    };

    initApp();

    return () => {
      destroyed = true;
      setIsReady(false);

      // Clear note graphics
      for (const graphics of noteGraphics.values()) {
        graphics.destroy();
      }
      noteGraphics.clear();
      notesContainerRef.current = null;

      // Destroy app if it was initialized
      if (appRef.current) {
        try {
          appRef.current.destroy(true, { children: true });
        } catch {
          // Ignore errors during cleanup
        }
        appRef.current = null;
      }
    };
  }, []);

  // Render notes
  const renderNotes = useCallback(() => {
    const app = appRef.current;
    const notesContainer = notesContainerRef.current;
    const file = getCurrentFile();

    if (!app || !notesContainer || !file) {
      // Debug log only occasionally to avoid spam
      if (Math.random() < 0.01) {
        console.log('[FallingNotes] renderNotes skipped - app:', !!app, 'container:', !!notesContainer, 'file:', !!file);
      }
      return;
    }

    const { width, height: canvasHeight } = app.screen;
    if (width === 0 || canvasHeight === 0) {
      console.log('[FallingNotes] Canvas has zero dimensions');
      return;
    }

    // Read currentTime directly from store to avoid dependency on playback.currentTime
    const currentTime = getPlaybackTime();

    // Get visible notes
    const visibleNotes = getVisibleNotes(file, currentTime, lookahead);

    // Debug log every ~60 frames
    if (Math.random() < 0.016) {
      console.log('[FallingNotes] renderNotes - currentTime:', currentTime.toFixed(3), 'visibleNotes:', visibleNotes.length, 'canvasHeight:', canvasHeight);
    }

    // Track which notes are still visible
    const visibleNoteKeys = new Set<string>();

    // Pixels per second (how fast notes fall)
    const pixelsPerSecond = canvasHeight / lookahead;

    for (const note of visibleNotes) {
      const noteKey = `${note.track}-${note.noteNumber}-${note.startTime}`;
      visibleNoteKeys.add(noteKey);

      // Get or create graphics for this note
      let graphics = noteGraphicsRef.current.get(noteKey);
      if (!graphics) {
        graphics = new Graphics();
        notesContainer.addChild(graphics);
        noteGraphicsRef.current.set(noteKey, graphics);
      }

      // Calculate position
      const { x: noteX, width: noteWidth } = getNoteX(note.noteNumber);
      const x = noteX * width;
      const w = noteWidth * width - 2; // Small gap between notes

      // Y position: notes fall from top (future) to bottom (current time)
      const timeUntilNote = note.startTime - currentTime;
      const y = canvasHeight - (timeUntilNote + note.duration) * pixelsPerSecond;
      const h = note.duration * pixelsPerSecond;

      // Debug first note position occasionally
      if (Math.random() < 0.002 && visibleNotes.indexOf(note) === 0) {
        console.log('[FallingNotes] First note position - timeUntilNote:', timeUntilNote.toFixed(3), 'y:', y.toFixed(1), 'h:', h.toFixed(1), 'pixelsPerSecond:', pixelsPerSecond.toFixed(1));
      }

      // Get color from track
      const track = file.tracks.find((t) => t.index === note.track);
      const color = track?.color || (note.noteNumber < 60 ? settings.leftHandColor : settings.rightHandColor);

      // Convert hex color to number
      const colorNum = parseInt(color.replace('#', ''), 16);

      // Check if note is currently active (being played)
      const isActive = note.startTime <= currentTime && note.startTime + note.duration > currentTime;

      // Draw the note
      graphics.clear();
      graphics
        .roundRect(x + 1, y, w, Math.max(h, 4), 4)
        .fill({ color: colorNum, alpha: isActive ? 1 : 0.85 });

      // Add glow effect for active notes
      if (isActive) {
        graphics
          .roundRect(x - 1, y - 2, w + 4, h + 4, 6)
          .fill({ color: colorNum, alpha: 0.3 });
      }
    }

    // Remove notes that are no longer visible
    for (const [key, graphics] of noteGraphicsRef.current) {
      if (!visibleNoteKeys.has(key)) {
        notesContainer.removeChild(graphics);
        graphics.destroy();
        noteGraphicsRef.current.delete(key);
      }
    }
  // Note: getCurrentFile and playback.currentTime are read via getState()
  // to avoid recreating this callback and to always get fresh data
   
  }, [lookahead, settings.leftHandColor, settings.rightHandColor]);

  // Keep ref updated with latest renderNotes
  renderNotesRef.current = renderNotes;

  // Animation loop - only start when ready
  useEffect(() => {
    if (!isReady) return;

    const app = appRef.current;
    if (!app) return;

    console.log('[FallingNotes] Starting animation ticker (once)');
    const ticker = () => {
      // Call via ref to always use latest version
      renderNotesRef.current();
    };

    app.ticker.add(ticker);

    return () => {
      if (app.ticker) {
        app.ticker.remove(ticker);
      }
    };
  }, [isReady]);

  // Handle resize
  useEffect(() => {
    if (!isReady) return;

    const handleResize = () => {
      const app = appRef.current;
      const container = containerRef.current;
      const gridGraphics = gridGraphicsRef.current;
      if (app && container && app.renderer) {
        app.renderer.resize(container.clientWidth, container.clientHeight);
        // Redraw grid after resize
        if (gridGraphics) {
          const theme = useMidiStore.getState().settings.theme;
          drawGrid(app, gridGraphics, theme);
        }
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isReady]);

  // Update canvas background and grid when theme changes
  useEffect(() => {
    const app = appRef.current;
    const gridGraphics = gridGraphicsRef.current;
    if (!app || !isReady) return;

    const bgColor = settings.theme === 'latte' ? 0xe6e9ef : 0x181825;
    app.renderer.background.color = bgColor;

    // Redraw grid with new theme colors
    if (gridGraphics) {
      drawGrid(app, gridGraphics, settings.theme);
    }
  }, [settings.theme, isReady]);

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
