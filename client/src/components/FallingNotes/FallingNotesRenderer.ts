import {
  Application,
  Graphics,
  Container,
  Text,
  TextStyle,
  BitmapFont,
  BitmapText,
  NineSliceSprite,
  Texture,
} from 'pixi.js';
import {
  useMidiStore,
  createSortedNotesIndex,
  getVisibleNotesFast,
} from '../../stores/midiStore';
import {
  isBlackKey,
  getPitchColor,
  NOTE_NAMES,
  MidiTrack,
  MidiNote,
  MidiFile,
} from '../../types/midi';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Corner radius for note rounded rects (in pixels, preserved by 9-slice) */
const NOTE_CORNER_RADIUS = 4;
/** Texture size — must be at least 2 * NOTE_CORNER_RADIUS */
const NOTE_TEX_SIZE = 16;

/** Bitmap font names installed at init */
const BITMAP_FONT_MAIN = 'noteLabel';
const BITMAP_FONT_ACC = 'noteLabelAcc';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Compute note X positions (0-1 range) for a given note range */
function computeNotePositions(
  minNote: number,
  maxNote: number,
): Map<number, { x: number; width: number }> {
  const positions = new Map<number, { x: number; width: number }>();

  let totalWhiteKeys = 0;
  for (let n = minNote; n <= maxNote; n++) {
    if (!isBlackKey(n)) totalWhiteKeys++;
  }

  const whiteKeyWidth = 1 / totalWhiteKeys;
  const blackKeyWidth = whiteKeyWidth * 0.6;

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
  notePositions: Map<number, { x: number; width: number }>,
) {
  const { width, height } = app.screen;
  if (width === 0 || height === 0) return;

  graphics.clear();

  const isLight = theme === 'latte';
  const lineColor = isLight ? 0xc8c2b8 : 0x3e4451;
  const blackKeyBg = isLight ? 0xebe7e0 : 0x21252b;

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

/** Generate a white rounded-rect texture for 9-slice note sprites */
function createNoteTexture(app: Application): Texture {
  const g = new Graphics();
  g.roundRect(0, 0, NOTE_TEX_SIZE, NOTE_TEX_SIZE, NOTE_CORNER_RADIUS);
  g.fill({ color: 0xffffff });
  const texture = app.renderer.generateTexture(g);
  g.destroy();
  return texture;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface NoteObj {
  sprite: NineSliceSprite;
  glowSprite: NineSliceSprite;
  text: BitmapText;
  accidentalText: BitmapText | null;
  noteNumber: number;
  posX: number;
  posW: number;
}

export interface RendererOptions {
  seek: (time: number) => void;
}

// ---------------------------------------------------------------------------
// FallingNotesRenderer
// ---------------------------------------------------------------------------

/** Reusable array for collecting notes to remove (avoids Map delete-during-iteration) */
const _removeBuffer: MidiNote[] = [];

export class FallingNotesRenderer {
  // Container & app
  private container: HTMLDivElement;
  private app: Application | null = null;
  private destroyed = false;

  // PixiJS display objects
  private gridGraphics: Graphics | null = null;
  private notesContainer: Container | null = null;
  private glowContainer: Container | null = null;
  private fpsText: Text | null = null;
  private noteTexture: Texture | null = null;

  // Active note objects keyed by MidiNote reference
  private noteObjects = new Map<MidiNote, NoteObj>();

  // Object pools
  private spritePool: NineSliceSprite[] = [];
  private glowSpritePool: NineSliceSprite[] = [];
  private textPool: BitmapText[] = [];
  private accTextPool: BitmapText[] = [];

  // Persistent set for visible notes (cleared each frame, not reallocated)
  private visibleNotesSet = new Set<MidiNote>();

  // Config state
  private minNote = 21;
  private maxNote = 108;
  private notePositions: Map<number, { x: number; width: number }> = new Map();
  private theme = '';
  private noteColorMode = 'hand';
  private leftHandColor = '#4fc3f7';
  private rightHandColor = '#81c784';
  private lookahead = 3;

  // File-derived state
  private sortedNotes: { notes: MidiNote[]; maxDuration: number } = {
    notes: [],
    maxDuration: 0,
  };
  private enabledTracks = new Set<number>();
  private trackMap = new Map<number, MidiTrack>();
  private currentFile: MidiFile | null = null;

  // Render state
  private lastRenderedTime: number | null = null;
  private renderTickerFn: (() => void) | null = null;
  private fpsTickerFn: ((ticker: { deltaMS: number }) => void) | null = null;

  // External actions
  private seek: (time: number) => void;

  // Bound handlers (stored for cleanup)
  private handleWheelBound: (e: WheelEvent) => void;
  private resizeObserver: ResizeObserver | null = null;

  constructor(container: HTMLDivElement, options: RendererOptions) {
    this.container = container;
    this.seek = options.seek;
    this.handleWheelBound = this.handleWheel.bind(this);
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async init(): Promise<void> {
    const theme = useMidiStore.getState().settings.theme;
    this.theme = theme;
    const bgColor = theme === 'latte' ? 0xf5f2ed : 0x1e2127;

    const app = new Application();
    await app.init({
      backgroundColor: bgColor,
      antialias: false,
      resolution: Math.min(window.devicePixelRatio || 1, 1.5),
      autoDensity: true,
      width: this.container.clientWidth,
      height: this.container.clientHeight,
    });

    if (this.destroyed) {
      app.destroy(true, { children: true });
      return;
    }

    app.canvas.style.width = '100%';
    app.canvas.style.height = '100%';
    app.canvas.style.display = 'block';
    this.container.appendChild(app.canvas);
    this.app = app;

    // Note texture
    this.noteTexture = createNoteTexture(app);

    // Grid
    const gridGraphics = new Graphics();
    app.stage.addChild(gridGraphics);
    this.gridGraphics = gridGraphics;

    // Glow container (behind notes, above grid)
    const glowContainer = new Container();
    glowContainer.cullable = true;
    app.stage.addChild(glowContainer);
    this.glowContainer = glowContainer;

    // Notes container (above glow)
    const notesContainer = new Container();
    notesContainer.cullable = true;
    app.stage.addChild(notesContainer);
    this.notesContainer = notesContainer;

    // Bitmap fonts
    this.installBitmapFonts(theme);

    // Draw initial grid
    this.notePositions = computeNotePositions(this.minNote, this.maxNote);
    drawGrid(app, gridGraphics, theme, this.minNote, this.maxNote, this.notePositions);

    // Cap frame rate
    app.ticker.maxFPS = 60;

    // FPS counter
    const fpsText = new Text({
      text: 'FPS: --',
      style: new TextStyle({
        fontFamily: 'monospace',
        fontSize: 12,
        fill: theme === 'latte' ? '#4c4f69' : '#a6adc8',
      }),
    });
    fpsText.x = app.screen.width - 70;
    fpsText.y = 8;
    fpsText.alpha = 0.7;
    app.stage.addChild(fpsText);
    this.fpsText = fpsText;

    // FPS ticker
    let fpsElapsed = 0;
    this.fpsTickerFn = (ticker: { deltaMS: number }) => {
      fpsElapsed += ticker.deltaMS;
      if (fpsElapsed >= 500) {
        fpsElapsed = 0;
        if (this.fpsText && this.app) {
          this.fpsText.text = `FPS: ${this.app.ticker.FPS.toFixed(0)}`;
        }
      }
    };
    app.ticker.add(this.fpsTickerFn);

    // Render ticker
    this.renderTickerFn = () => this.renderNotes();
    app.ticker.add(this.renderTickerFn);

    // Resize observer
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);

    // Wheel-to-seek
    this.container.addEventListener('wheel', this.handleWheelBound, {
      passive: false,
    });
  }

  destroy(): void {
    this.destroyed = true;

    // Remove wheel listener
    this.container.removeEventListener('wheel', this.handleWheelBound);

    // Disconnect resize observer
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    // Release all active note objects
    for (const noteObj of this.noteObjects.values()) {
      noteObj.sprite.destroy();
      noteObj.glowSprite.destroy();
      noteObj.text.destroy();
      noteObj.accidentalText?.destroy();
    }
    this.noteObjects.clear();

    // Destroy pooled objects
    for (const s of this.spritePool) s.destroy();
    for (const s of this.glowSpritePool) s.destroy();
    for (const t of this.textPool) t.destroy();
    for (const t of this.accTextPool) t.destroy();
    this.spritePool.length = 0;
    this.glowSpritePool.length = 0;
    this.textPool.length = 0;
    this.accTextPool.length = 0;

    // Destroy texture
    this.noteTexture?.destroy(true);
    this.noteTexture = null;

    this.fpsText = null;
    this.notesContainer = null;
    this.glowContainer = null;

    // Destroy app
    if (this.app) {
      try {
        this.app.destroy(true, { children: true });
      } catch {
        // Ignore errors during cleanup
      }
      this.app = null;
    }
  }

  // -----------------------------------------------------------------------
  // Config setters (called by React when props/state change)
  // -----------------------------------------------------------------------

  setNoteRange(minNote: number, maxNote: number): void {
    if (this.minNote === minNote && this.maxNote === maxNote) return;
    this.minNote = minNote;
    this.maxNote = maxNote;
    this.notePositions = computeNotePositions(minNote, maxNote);

    if (this.app && this.gridGraphics) {
      const theme = useMidiStore.getState().settings.theme;
      drawGrid(this.app, this.gridGraphics, theme, minNote, maxNote, this.notePositions);
    }

    // Clear cached notes so they get recreated with new positions
    this.clearNoteObjects();
    this.lastRenderedTime = null;
  }

  setTheme(theme: string): void {
    if (this.theme === theme) return;
    this.theme = theme;
    const app = this.app;
    if (!app) return;

    const bgColor = theme === 'latte' ? 0xf5f2ed : 0x1e2127;
    app.renderer.background.color = bgColor;

    // Redraw grid
    if (this.gridGraphics) {
      drawGrid(app, this.gridGraphics, theme, this.minNote, this.maxNote, this.notePositions);
    }

    // Reinstall bitmap fonts with new theme colors
    this.installBitmapFonts(theme);

    // Update FPS counter style
    if (this.fpsText) {
      this.fpsText.style.fill = theme === 'latte' ? '#4c4f69' : '#a6adc8';
    }

    // Clear cached notes so they get recreated with new theme text styles
    this.clearNoteObjects();
    this.lastRenderedTime = null;
  }

  setColorSettings(
    noteColorMode: string,
    leftHandColor: string,
    rightHandColor: string,
  ): void {
    this.noteColorMode = noteColorMode;
    this.leftHandColor = leftHandColor;
    this.rightHandColor = rightHandColor;
  }

  setFile(file: MidiFile | null): void {
    this.currentFile = file;
    if (!file) {
      this.sortedNotes = { notes: [], maxDuration: 0 };
      this.enabledTracks = new Set();
      this.trackMap = new Map();
      return;
    }

    this.sortedNotes = createSortedNotesIndex(file);

    const enabledTracks = new Set<number>();
    const trackMap = new Map<number, MidiTrack>();
    for (const track of file.tracks) {
      trackMap.set(track.index, track);
      if (track.enabled || track.renderOnly) {
        enabledTracks.add(track.index);
      }
    }
    this.enabledTracks = enabledTracks;
    this.trackMap = trackMap;
  }

  setLookahead(lookahead: number): void {
    this.lookahead = lookahead;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private installBitmapFonts(theme: string): void {
    const textColor = theme === 'latte' ? '#1e1e2e' : '#cdd6f4';
    BitmapFont.install({
      name: BITMAP_FONT_MAIN,
      style: {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 12,
        fontWeight: 'bold',
        fill: textColor,
      },
      chars: [['A', 'G'], '#b'],
    });
    BitmapFont.install({
      name: BITMAP_FONT_ACC,
      style: {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 9,
        fontWeight: 'bold',
        fill: textColor,
      },
      chars: '#b♯♭',
    });
  }

  private clearNoteObjects(): void {
    for (const noteObj of this.noteObjects.values()) {
      this.releaseNoteObj(noteObj);
    }
    this.noteObjects.clear();
  }

  // -- Object pool helpers ------------------------------------------------

  private acquireSprite(texture: Texture, parent: Container): NineSliceSprite {
    const pool = this.spritePool;
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
      parent.addChild(sprite);
    }
    return sprite;
  }

  private acquireGlowSprite(texture: Texture, parent: Container): NineSliceSprite {
    const pool = this.glowSpritePool;
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
      parent.addChild(sprite);
    }
    return sprite;
  }

  private acquireText(content: string, parent: Container): BitmapText {
    const pool = this.textPool;
    let text: BitmapText;
    if (pool.length > 0) {
      text = pool.pop()!;
      text.text = content;
      text.visible = true;
    } else {
      text = new BitmapText({
        text: content,
        style: { fontFamily: BITMAP_FONT_MAIN, fontSize: 12 },
      });
      text.anchor.set(0.5, 0);
      parent.addChild(text);
    }
    return text;
  }

  private acquireAccText(content: string, parent: Container): BitmapText {
    const pool = this.accTextPool;
    let text: BitmapText;
    if (pool.length > 0) {
      text = pool.pop()!;
      text.text = content;
      text.visible = true;
    } else {
      text = new BitmapText({
        text: content,
        style: { fontFamily: BITMAP_FONT_ACC, fontSize: 9 },
      });
      text.anchor.set(0.5, 0);
      parent.addChild(text);
    }
    return text;
  }

  private releaseNoteObj(noteObj: NoteObj): void {
    noteObj.sprite.visible = false;
    this.spritePool.push(noteObj.sprite);

    noteObj.glowSprite.visible = false;
    this.glowSpritePool.push(noteObj.glowSprite);

    noteObj.text.visible = false;
    this.textPool.push(noteObj.text);

    if (noteObj.accidentalText) {
      noteObj.accidentalText.visible = false;
      this.accTextPool.push(noteObj.accidentalText);
    }
  }

  // -- Event handlers -----------------------------------------------------

  private handleResize(): void {
    const app = this.app;
    if (!app || !app.renderer) return;

    app.renderer.resize(this.container.clientWidth, this.container.clientHeight);

    if (this.gridGraphics) {
      const theme = useMidiStore.getState().settings.theme;
      drawGrid(app, this.gridGraphics, theme, this.minNote, this.maxNote, this.notePositions);
    }

    if (this.fpsText) {
      this.fpsText.x = app.screen.width - 70;
    }

    this.lastRenderedTime = null;
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();

    const file = this.currentFile;
    if (!file) return;

    const canvasHeight = this.container.clientHeight || 600;
    const pixelsPerSecond = canvasHeight / this.lookahead;

    const timeDelta = e.deltaY / pixelsPerSecond;
    const currentTime = useMidiStore.getState().playback.currentTime;
    const newTime = Math.max(0, Math.min(currentTime + timeDelta, file.duration));

    this.seek(newTime);
  }

  // -- Main render loop ---------------------------------------------------

  private renderNotes(): void {
    const app = this.app;
    const notesContainer = this.notesContainer;
    const glowContainer = this.glowContainer;
    const noteTexture = this.noteTexture;
    const file = this.currentFile;

    if (!app || !notesContainer || !glowContainer || !noteTexture || !file) {
      return;
    }

    const { width, height: canvasHeight } = app.screen;
    if (width === 0 || canvasHeight === 0) return;

    // Single store read per frame
    const playback = useMidiStore.getState().playback;
    const currentTime = playback.currentTime;

    // Skip render when paused and nothing changed
    if (!playback.isPlaying && this.lastRenderedTime === currentTime) return;
    this.lastRenderedTime = currentTime;

    // Get visible notes via binary search
    const visibleNotes = getVisibleNotesFast(
      this.sortedNotes.notes,
      this.sortedNotes.maxDuration,
      currentTime,
      this.lookahead,
      this.enabledTracks,
    );

    // Reuse persistent Set
    const visibleNoteKeys = this.visibleNotesSet;
    visibleNoteKeys.clear();

    const pixelsPerSecond = canvasHeight / this.lookahead;

    for (const note of visibleNotes) {
      visibleNoteKeys.add(note);

      let noteObj = this.noteObjects.get(note);
      if (!noteObj) {
        const noteName = NOTE_NAMES[note.noteNumber % 12];
        const letter = noteName[0];
        const accidental = noteName.length > 1 ? noteName.slice(1) : null;

        const pos = this.notePositions.get(note.noteNumber);
        if (!pos) continue;

        const sprite = this.acquireSprite(noteTexture, notesContainer);
        const glowSprite = this.acquireGlowSprite(noteTexture, glowContainer);
        const text = this.acquireText(letter, notesContainer);

        let accidentalText: BitmapText | null = null;
        if (accidental) {
          accidentalText = this.acquireAccText(accidental, notesContainer);
        }

        noteObj = {
          sprite,
          glowSprite,
          text,
          accidentalText,
          noteNumber: note.noteNumber,
          posX: pos.x,
          posW: pos.width,
        };
        this.noteObjects.set(note, noteObj);
      }

      const { sprite, glowSprite, text, accidentalText, posX, posW } = noteObj;

      const x = posX * width;
      const w = posW * width - 2;

      const timeUntilNote = note.startTime - currentTime;
      const y = canvasHeight - (timeUntilNote + note.duration) * pixelsPerSecond;
      const h = Math.max(note.duration * pixelsPerSecond, 4);

      const track = this.trackMap.get(note.track);
      const isRenderOnly = track ? !track.enabled && track.renderOnly : false;

      let color: string;
      if (this.noteColorMode === 'pitch') {
        color = getPitchColor(note.noteNumber);
      } else {
        color =
          track?.color ||
          (note.noteNumber < 60 ? this.leftHandColor : this.rightHandColor);
      }

      const colorNum = parseColor(color);

      const isActive =
        note.startTime <= currentTime &&
        note.startTime + note.duration > currentTime;

      const baseAlpha = isRenderOnly ? 0.35 : isActive ? 1 : 0.85;

      sprite.x = x + 1;
      sprite.y = y;
      sprite.width = w;
      sprite.height = h;
      sprite.tint = colorNum;
      sprite.alpha = baseAlpha;

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

      text.x = x + 1 + w / 2;
      text.y = y + h - (accidentalText ? 24 : 16);
      text.alpha = baseAlpha;
      text.visible = h > (accidentalText ? 30 : 20);

      if (accidentalText) {
        accidentalText.x = x + 1 + w / 2;
        accidentalText.y = y + h - 12;
        accidentalText.alpha = baseAlpha;
        accidentalText.visible = h > 30;
      }
    }

    // Pool notes no longer visible
    _removeBuffer.length = 0;
    for (const [noteRef, noteObj] of this.noteObjects) {
      if (!visibleNoteKeys.has(noteRef)) {
        this.releaseNoteObj(noteObj);
        _removeBuffer.push(noteRef);
      }
    }
    for (let i = 0; i < _removeBuffer.length; i++) {
      this.noteObjects.delete(_removeBuffer[i]);
    }
  }
}
