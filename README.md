# NoteRain

**[noterain.app](https://noterain.app)**

A modern web-based MIDI player and piano learning tool with falling notes visualization, sheet music rendering, and MIDI keyboard support.

## Features

### Playback Controls
- **Play/Pause/Stop** - Full transport controls for MIDI playback
- **Speed Control** - Adjust playback speed from 10% to 200%
- **Seek** - Click on the progress bar or scroll through sheet music to navigate
- **Measure Looping** - Set start and end measures to practice specific sections
- **Wait Mode** - Pauses playback until you play the correct notes on your MIDI keyboard

### Visualization

#### Falling Notes
- Animated falling notes display (Synthesia-style)
- Configurable lookahead time
- Note name labels with accidentals
- Glow effect on active notes
- Grid overlay aligned to piano keys

#### Sheet Music
- Real-time staff notation rendering with VexFlow
- Automatic clef selection (treble/bass) per track
- Key signature detection and proper accidental handling
- Time signature support with correct beam grouping
- Multi-track grand staff display
- Auto-scroll during playback
- Scroll-to-seek when paused

#### Piano Keyboard
- Full 88-key piano display
- Interactive keys (click/touch to play)
- Visual feedback for playback and live input
- Note name labels

### Track Management
- **Enable/Disable Tracks** - Toggle tracks for playback
- **Render Only** - Display a track visually without playing audio (useful for learning)
- **Audio Toggle** - Mute/unmute individual tracks
- **Color Coding** - Each track has a distinct color

### Note Coloring
- **By Track** - Notes colored by their track
- **By Pitch** - Rainbow spectrum based on note pitch
- **Hand Colors** - Configurable left/right hand colors (split at middle C)

### MIDI Input
- WebMIDI support for hardware keyboards
- Automatic device detection
- Works with wait mode for practice
- Live note visualization on keyboard and falling notes

### Audio
- High-quality Salamander Grand Piano samples
- Velocity-sensitive playback
- Master volume control
- Polyphonic playback

### Themes
- **One Dark** - Dark theme based on Atom's One Dark
- **Latte** - Light theme based on Catppuccin Latte

### File Management
- Open MIDI files via file picker or drag-and-drop
- Multiple file support with easy switching
- Export to MIDI
- Persistent settings (theme, volume, colors, MIDI device)

## Getting Started

### Prerequisites
- Node.js 18+ or Bun
- A modern browser with WebMIDI support (Chrome, Edge, Opera)

### Installation

```bash
# Install dependencies
bun install

# Start development server
bun run dev
```

The app runs at `http://localhost:5173` (client) with the API server at `http://localhost:3000`.

### Production Build

```bash
# Build both client and server
bun run build

# Start production server
bun run start:prod
```

## Usage

1. **Load a MIDI file** - Click "Open MIDI" or drag a .mid file onto the window
2. **Choose a view** - Toggle between falling notes and sheet music
3. **Connect a MIDI keyboard** (optional) - Select your device from the dropdown
4. **Enable Wait Mode** (optional) - Practice by playing along; playback pauses until you hit the right notes
5. **Set a loop** (optional) - Enter start/end measure numbers to practice a section
6. **Press Play** - Watch, listen, and learn!

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite
- **Visualization**: PixiJS (falling notes), VexFlow (sheet music)
- **Audio**: Tone.js with Salamander Grand Piano samples
- **MIDI**: WebMIDI API, midi-file parser
- **State**: Zustand with localStorage persistence
- **Backend**: NestJS (serves static files and API)

## Project Structure

```
piano/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # UI components
│   │   │   ├── Controls/   # Playback controls, settings
│   │   │   ├── FallingNotes/   # PixiJS visualization
│   │   │   ├── PianoKeyboard/  # Interactive keyboard
│   │   │   └── SheetMusic/     # VexFlow notation
│   │   ├── hooks/          # Custom React hooks
│   │   ├── lib/            # MIDI parsing, audio
│   │   ├── stores/         # Zustand state management
│   │   └── types/          # TypeScript types
│   └── public/             # Static assets
├── src/                    # NestJS backend
└── dist/                   # Production build output
```

## License

GPL-3.0
