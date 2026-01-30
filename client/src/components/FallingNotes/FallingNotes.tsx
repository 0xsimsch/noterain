import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { Application, Graphics, Container, Text, TextStyle, NineSliceSprite, Texture } from 'pixi.js';
import { useMidiStore, createSortedNotesIndex, getVisibleNotesFast } from '../../stores/midiStore';
import {
  PIANO_MIN_NOTE,
  PIANO_MAX_NOTE,
  isBlackKey,
  getPitchColor,
  NOTE_NAMES,
  MidiTrack,
  MidiNote,
} from '../../types/midi';

interface FallingNotesProps {
  /** How many seconds of notes to show ahead */
  lookahead?: number;
  /** Minimum note to render (default: PIANO_MIN_NOTE) */
  minNote?: number;
  /** Maximum note to render (default: PIANO_MAX_NOTE) */
  maxNote?: number;
}

/** Compute note X positions (0-1 range) for a given note range */
function computeNotePositions(
  minNote: number,
  maxNote: number
): Map<number, { x: number; width: number }> {
  const positions = new Map<number, { x: number; width: number }>();

  // Count total white keys in range
  let totalWhiteKeys = 0;
  for (let n = minNote; n <= maxNote; n++) {
    if (!isBlackKey(n)) totalWhiteKeys++;
  }

  const whiteKeyWidth = 1 / totalWhiteKeys;
  const blackKeyWidth = whiteKeyWidth * 0.6;

  // Compute all positions
  let whiteKeyIndex = 0;
  for (let note = minNote; note <= maxNote; note++) {
    if (isBlackKey(note)) {
      const x = whiteKeyIndex * whiteKeyWidth - blackKeyWidth / 2;
      positions.set(note, { x, width: blackKeyWidth });
    } else {
      positions.set(note, { x: whiteKeyIndex * whiteKeyWidth, width: whiteKeyWidth });
      whiteKeyIndex++;
    }
  }

  return positions;
}

/** Cached TextStyle objects to avoid recreation */
const TEXT_STYLE_CACHE: Record<string, { main: TextStyle; accidental: TextStyle }> = {};

function getTextStyles(theme: string): { main: TextStyle; accidental: TextStyle } {
  if (!TEXT_STYLE_CACHE[theme]) {
    const textColor = theme === 'latte' ? '#1e1e2e' : '#cdd6f4';
    TEXT_STYLE_CACHE[theme] = {
      main: new TextStyle({
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 12,
        fontWeight: 'bold',
        fill: textColor,
      }),
      accidental: new TextStyle({
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 9,
        fontWeight: 'bold',
        fill: textColor,
      }),
    };
  }
  return TEXT_STYLE_CACHE[theme];
}

/** Cache for parsed hex colors */
const _colorParseCache = new Map<string, number>();

function parseColor(hex: string): number {
  let cached = _colorParseCache.get(hex);
  if (cached !== undefined) return cached;
  cached = parseInt(hex.replace('#', ''), 16);
  _colorParseCache.set(hex, cached);
  return cached;
}

/** Draw vertical grid lines for each piano key */
function drawGrid(
  app: Application,
  graphics: Graphics,
  theme: string,
  minNote: number,
  maxNote: number,
  notePositions: Map<number, { x: number; width: number }>
) {
  const { width, height } = app.screen;
  if (width === 0 || height === 0) return;

  graphics.clear();

  const isLight = theme === 'latte';
  const lineColor = isLight ? 0xc8c2b8 : 0x3e4451;
  const blackKeyBg = isLight ? 0xebe7e0 : 0x21252b;

  // Draw background shading for black key lanes
  for (let note = minNote; note <= maxNote; note++) {
    if (isBlackKey(note)) {
      const pos = notePositions.get(note);
      if (pos) {
        graphics
          .rect(pos.x * width, 0, pos.width * width, height)
          .fill({ color: blackKeyBg, alpha: 0.5 });
      }
    }
  }

  // Draw vertical lines at white key boundaries
  let whiteKeyIndex = 0;
  let totalWhiteKeys = 0;
  for (let n = minNote; n <= maxNote; n++) {
    if (!isBlackKey(n)) totalWhiteKeys++;
  }

  const whiteKeyWidth = width / totalWhiteKeys;

  for (let note = minNote; note <= maxNote; note++) {
    if (!isBlackKey(note)) {
      const x = whiteKeyIndex * whiteKeyWidth;
      graphics
        .moveTo(x, 0)
        .lineTo(x, height)
        .stroke({ color: lineColor, width: 1, alpha: 0.7 });
      whiteKeyIndex++;
    }
  }
}

/** Corner radius for note rounded rects (in pixels, preserved by 9-slice) */
const NOTE_CORNER_RADIUS = 4;
/** Texture size — must be at least 2 * NOTE_CORNER_RADIUS */
const NOTE_TEX_SIZE = 16;

/** Generate a white rounded-rect texture for 9-slice note sprites */
function createNoteTexture(app: Application): Texture {
  const g = new Graphics();
  g.roundRect(0, 0, NOTE_TEX_SIZE, NOTE_TEX_SIZE, NOTE_CORNER_RADIUS);
  g.fill({ color: 0xffffff });
  const texture = app.renderer.generateTexture(g);
  g.destroy();
  return texture;
}

interface NoteObj {
  sprite: NineSliceSprite;
  glowSprite: NineSliceSprite;
  text: Text;
  accidentalText: Text | null;
  noteNumber: number;
}

export function FallingNotes({
  lookahead = 3,
  minNote = PIANO_MIN_NOTE,
  maxNote = PIANO_MAX_NOTE,
}: FallingNotesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const notesContainerRef = useRef<Container | null>(null);
  const glowContainerRef = useRef<Container | null>(null);
  const gridGraphicsRef = useRef<Graphics | null>(null);
  const noteObjectsRef = useRef<Map<MidiNote, NoteObj>>(new Map());
  const noteTextureRef = useRef<Texture | null>(null);
  const renderNotesRef = useRef<() => void>(() => {});
  const [isReady, setIsReady] = useState(false);

  // Object pools
  const spritePoolRef = useRef<NineSliceSprite[]>([]);
  const glowSpritePoolRef = useRef<NineSliceSprite[]>([]);
  const textPoolRef = useRef<Text[]>([]);
  const accTextPoolRef = useRef<Text[]>([]);

  // Persistent set for tracking visible notes (cleared each frame, not reallocated)
  const visibleNotesSetRef = useRef<Set<MidiNote>>(new Set());

  const { settings } = useMidiStore();

  // Memoize note positions based on range
  const notePositions = useMemo(
    () => computeNotePositions(minNote, maxNote),
    [minNote, maxNote]
  );

  // Store current values in refs for access inside effects
  const minNoteRef = useRef(minNote);
  const maxNoteRef = useRef(maxNote);
  const notePositionsRef = useRef(notePositions);
  minNoteRef.current = minNote;
  maxNoteRef.current = maxNote;
  notePositionsRef.current = notePositions;

  const seek = useMidiStore((state) => state.seek);
  const currentFileId = useMidiStore((state) => state.currentFileId);
  const files = useMidiStore((state) => state.files);

  // Use getState() to read values inside animation loop without causing re-renders
  const getPlaybackTime = () => useMidiStore.getState().playback.currentTime;
  const getCurrentFile = () => {
    const state = useMidiStore.getState();
    return state.files.find((f) => f.id === state.currentFileId) || null;
  };

  // Memoize current file
  const currentFile = useMemo(() => {
    return files.find((f) => f.id === currentFileId) || null;
  }, [files, currentFileId]);

  // Build sorted notes index once when file/tracks change (for binary search)
  const sortedNotesRef = useRef<{ notes: ReturnType<typeof createSortedNotesIndex>['notes']; maxDuration: number }>({ notes: [], maxDuration: 0 });
  const enabledTracksRef = useRef<Set<number>>(new Set());
  const trackMapRef = useRef<Map<number, MidiTrack>>(new Map());

  // Update indexes when file or track settings change
  useEffect(() => {
    if (!currentFile) {
      sortedNotesRef.current = { notes: [], maxDuration: 0 };
      enabledTracksRef.current = new Set();
      trackMapRef.current = new Map();
      return;
    }

    // Build sorted notes index with max duration
    sortedNotesRef.current = createSortedNotesIndex(currentFile);

    // Build enabled tracks set and track map
    const enabledTracks = new Set<number>();
    const trackMap = new Map<number, MidiTrack>();
    for (const track of currentFile.tracks) {
      trackMap.set(track.index, track);
      if (track.enabled || track.renderOnly) {
        enabledTracks.add(track.index);
      }
    }
    enabledTracksRef.current = enabledTracks;
    trackMapRef.current = trackMap;
  }, [currentFile]);

  // Pool helpers
  const acquireSprite = useCallback((texture: Texture, parent: Container): NineSliceSprite => {
    const pool = spritePoolRef.current;
    let sprite: NineSliceSprite;
    if (pool.length > 0) {
      sprite = pool.pop()!;
      sprite.texture = texture;
      sprite.visible = true;
    } else {
      sprite = new NineSliceSprite({
        texture,
        leftWidth: NOTE_CORNER_RADIUS,
        rightWidth: NOTE_CORNER_RADIUS,
        topHeight: NOTE_CORNER_RADIUS,
        bottomHeight: NOTE_CORNER_RADIUS,
      });
    }
    parent.addChild(sprite);
    return sprite;
  }, []);

  const acquireGlowSprite = useCallback((texture: Texture, parent: Container): NineSliceSprite => {
    const pool = glowSpritePoolRef.current;
    let sprite: NineSliceSprite;
    if (pool.length > 0) {
      sprite = pool.pop()!;
      sprite.texture = texture;
      sprite.visible = true;
    } else {
      sprite = new NineSliceSprite({
        texture,
        leftWidth: NOTE_CORNER_RADIUS,
        rightWidth: NOTE_CORNER_RADIUS,
        topHeight: NOTE_CORNER_RADIUS,
        bottomHeight: NOTE_CORNER_RADIUS,
      });
    }
    parent.addChild(sprite);
    return sprite;
  }, []);

  const acquireText = useCallback((content: string, style: TextStyle, parent: Container): Text => {
    const pool = textPoolRef.current;
    let text: Text;
    if (pool.length > 0) {
      text = pool.pop()!;
      text.text = content;
      text.style = style;
      text.visible = true;
    } else {
      text = new Text({ text: content, style });
      text.anchor.set(0.5, 0);
    }
    parent.addChild(text);
    return text;
  }, []);

  const acquireAccText = useCallback((content: string, style: TextStyle, parent: Container): Text => {
    const pool = accTextPoolRef.current;
    let text: Text;
    if (pool.length > 0) {
      text = pool.pop()!;
      text.text = content;
      text.style = style;
      text.visible = true;
    } else {
      text = new Text({ text: content, style });
      text.anchor.set(0.5, 0);
    }
    parent.addChild(text);
    return text;
  }, []);

  const releaseNoteObj = useCallback((noteObj: NoteObj) => {
    const notesContainer = notesContainerRef.current;
    const glowContainer = glowContainerRef.current;

    noteObj.sprite.visible = false;
    notesContainer?.removeChild(noteObj.sprite);
    spritePoolRef.current.push(noteObj.sprite);

    noteObj.glowSprite.visible = false;
    glowContainer?.removeChild(noteObj.glowSprite);
    glowSpritePoolRef.current.push(noteObj.glowSprite);

    noteObj.text.visible = false;
    notesContainer?.removeChild(noteObj.text);
    textPoolRef.current.push(noteObj.text);

    if (noteObj.accidentalText) {
      noteObj.accidentalText.visible = false;
      notesContainer?.removeChild(noteObj.accidentalText);
      accTextPoolRef.current.push(noteObj.accidentalText);
    }
  }, []);

  // Initialize PixiJS
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const noteObjects = noteObjectsRef.current;
    let destroyed = false;
    const app = new Application();

    const initApp = async () => {
      try {
        // Get theme-appropriate background color
        const theme = useMidiStore.getState().settings.theme;
        const bgColor = theme === 'latte' ? 0xf5f2ed : 0x1e2127;

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

        // Create note texture (one white rounded rect, tinted per sprite)
        noteTextureRef.current = createNoteTexture(app);

        // Create grid graphics (behind notes)
        const gridGraphics = new Graphics();
        app.stage.addChild(gridGraphics);
        gridGraphicsRef.current = gridGraphics;

        // Create glow container (behind notes, above grid)
        const glowContainer = new Container();
        app.stage.addChild(glowContainer);
        glowContainerRef.current = glowContainer;

        // Create notes container (above glow)
        const notesContainer = new Container();
        app.stage.addChild(notesContainer);
        notesContainerRef.current = notesContainer;

        // Draw initial grid
        drawGrid(app, gridGraphics, theme, minNoteRef.current, maxNoteRef.current, notePositionsRef.current);

        setIsReady(true);
      } catch (err) {
        console.error('Failed to initialize PixiJS:', err);
      }
    };

    initApp();

    return () => {
      destroyed = true;
      setIsReady(false);

      // Release all note objects
      for (const noteObj of noteObjects.values()) {
        noteObj.sprite.destroy();
        noteObj.glowSprite.destroy();
        noteObj.text.destroy();
        noteObj.accidentalText?.destroy();
      }
      noteObjects.clear();

      // Destroy pooled objects
      for (const s of spritePoolRef.current) s.destroy();
      for (const s of glowSpritePoolRef.current) s.destroy();
      for (const t of textPoolRef.current) t.destroy();
      for (const t of accTextPoolRef.current) t.destroy();
      spritePoolRef.current.length = 0;
      glowSpritePoolRef.current.length = 0;
      textPoolRef.current.length = 0;
      accTextPoolRef.current.length = 0;

      // Destroy texture
      noteTextureRef.current?.destroy(true);
      noteTextureRef.current = null;

      notesContainerRef.current = null;
      glowContainerRef.current = null;

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
    const glowContainer = glowContainerRef.current;
    const noteTexture = noteTextureRef.current;
    const file = getCurrentFile();

    if (!app || !notesContainer || !glowContainer || !noteTexture || !file) {
      return;
    }

    const { width, height: canvasHeight } = app.screen;
    if (width === 0 || canvasHeight === 0) {
      return;
    }

    // Read currentTime directly from store to avoid dependency on playback.currentTime
    const currentTime = getPlaybackTime();

    // Get visible notes using binary search (O(log n + k) instead of O(n))
    const visibleNotes = getVisibleNotesFast(
      sortedNotesRef.current.notes,
      sortedNotesRef.current.maxDuration,
      currentTime,
      lookahead,
      enabledTracksRef.current
    );

    // Reuse persistent Set (clear instead of allocating new)
    const visibleNoteKeys = visibleNotesSetRef.current;
    visibleNoteKeys.clear();

    // Pixels per second (how fast notes fall)
    const pixelsPerSecond = canvasHeight / lookahead;

    // Get cached text styles
    const textStyles = getTextStyles(settings.theme);

    for (const note of visibleNotes) {
      // Use MidiNote object reference as key (stable identity from sorted index)
      visibleNoteKeys.add(note);

      // Get or create sprite objects for this note
      let noteObj = noteObjectsRef.current.get(note);
      if (!noteObj) {
        const noteName = NOTE_NAMES[note.noteNumber % 12];
        const letter = noteName[0];
        const accidental = noteName.length > 1 ? noteName.slice(1) : null;

        const sprite = acquireSprite(noteTexture, notesContainer);
        const glowSprite = acquireGlowSprite(noteTexture, glowContainer);
        const text = acquireText(letter, textStyles.main, notesContainer);

        let accidentalText: Text | null = null;
        if (accidental) {
          accidentalText = acquireAccText(accidental, textStyles.accidental, notesContainer);
        }

        noteObj = { sprite, glowSprite, text, accidentalText, noteNumber: note.noteNumber };
        noteObjectsRef.current.set(note, noteObj);
      }

      const { sprite, glowSprite, text, accidentalText } = noteObj;

      // Calculate position
      const pos = notePositionsRef.current.get(note.noteNumber);
      if (!pos) continue;
      const x = pos.x * width;
      const w = pos.width * width - 2; // Small gap between notes

      // Y position: notes fall from top (future) to bottom (current time)
      const timeUntilNote = note.startTime - currentTime;
      const y = canvasHeight - (timeUntilNote + note.duration) * pixelsPerSecond;
      const h = Math.max(note.duration * pixelsPerSecond, 4);

      // Get track info for color and render-only state (O(1) lookup)
      const track = trackMapRef.current.get(note.track);
      const isRenderOnly = track ? !track.enabled && track.renderOnly : false;

      // Get color based on color mode (with cached parsing)
      let color: string;
      if (settings.noteColorMode === 'pitch') {
        color = getPitchColor(note.noteNumber);
      } else {
        color =
          track?.color ||
          (note.noteNumber < 60
            ? settings.leftHandColor
            : settings.rightHandColor);
      }

      const colorNum = parseColor(color);

      // Check if note is currently active (being played)
      const isActive =
        note.startTime <= currentTime &&
        note.startTime + note.duration > currentTime;

      // Reduce opacity for render-only tracks
      const baseAlpha = isRenderOnly ? 0.35 : isActive ? 1 : 0.85;

      // Update sprite position, size, tint, and alpha (no GPU geometry rebuild)
      sprite.x = x + 1;
      sprite.y = y;
      sprite.width = w;
      sprite.height = h;
      sprite.tint = colorNum;
      sprite.alpha = baseAlpha;

      // Glow effect for active notes (rendered in separate container behind notes)
      if (isActive && !isRenderOnly) {
        glowSprite.visible = true;
        glowSprite.x = x - 1;
        glowSprite.y = y - 2;
        glowSprite.width = w + 4;
        glowSprite.height = h + 4;
        glowSprite.tint = colorNum;
        glowSprite.alpha = 0.3;
      } else {
        glowSprite.visible = false;
      }

      // Position the text label at bottom of note
      text.x = x + 1 + w / 2;
      text.y = y + h - (accidentalText ? 24 : 16);
      text.alpha = baseAlpha;
      text.visible = h > (accidentalText ? 30 : 20);

      // Position accidental underneath the letter
      if (accidentalText) {
        accidentalText.x = x + 1 + w / 2;
        accidentalText.y = y + h - 12;
        accidentalText.alpha = baseAlpha;
        accidentalText.visible = h > 30;
      }
    }

    // Pool notes that are no longer visible instead of destroying
    for (const [noteRef, noteObj] of noteObjectsRef.current) {
      if (!visibleNoteKeys.has(noteRef)) {
        releaseNoteObj(noteObj);
        noteObjectsRef.current.delete(noteRef);
      }
    }
  }, [
    lookahead,
    settings.leftHandColor,
    settings.rightHandColor,
    settings.noteColorMode,
    settings.theme,
    acquireSprite,
    acquireGlowSprite,
    acquireText,
    acquireAccText,
    releaseNoteObj,
  ]);

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
          drawGrid(app, gridGraphics, theme, minNoteRef.current, maxNoteRef.current, notePositionsRef.current);
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

    const bgColor = settings.theme === 'latte' ? 0xf5f2ed : 0x1e2127;
    app.renderer.background.color = bgColor;

    // Redraw grid with new theme colors
    if (gridGraphics) {
      drawGrid(app, gridGraphics, settings.theme, minNoteRef.current, maxNoteRef.current, notePositionsRef.current);
    }

    // Clear cached notes so they get recreated with new theme text styles
    for (const noteObj of noteObjectsRef.current.values()) {
      releaseNoteObj(noteObj);
    }
    noteObjectsRef.current.clear();
  }, [settings.theme, isReady, releaseNoteObj]);

  // Redraw grid and clear notes when note range changes
  useEffect(() => {
    const app = appRef.current;
    const gridGraphics = gridGraphicsRef.current;
    if (!app || !isReady) return;

    // Redraw grid with new range
    if (gridGraphics) {
      const theme = useMidiStore.getState().settings.theme;
      drawGrid(app, gridGraphics, theme, minNote, maxNote, notePositions);
    }

    // Clear cached notes so they get recreated with new positions
    for (const noteObj of noteObjectsRef.current.values()) {
      releaseNoteObj(noteObj);
    }
    noteObjectsRef.current.clear();
  }, [minNote, maxNote, notePositions, isReady, releaseNoteObj]);

  // Wheel-to-seek: scroll wheel changes playback position
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();

      const container = containerRef.current;
      const file = getCurrentFile();
      if (!container || !file) return;

      const canvasHeight = container.clientHeight || 600;
      const pixelsPerSecond = canvasHeight / lookahead;

      // Convert wheel delta to time delta
      // Positive deltaY (scroll down) = move forward in time
      const timeDelta = e.deltaY / pixelsPerSecond;

      const currentTime = getPlaybackTime();
      const newTime = Math.max(0, Math.min(currentTime + timeDelta, file.duration));

      seek(newTime);
    },
    [lookahead, seek],
  );

  // Attach wheel listener with passive: false to allow preventDefault
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

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
