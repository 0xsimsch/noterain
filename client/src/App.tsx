import { useCallback, useEffect } from 'react';
import { Controls } from './components/Controls/Controls';
import { FallingNotes } from './components/FallingNotes/FallingNotes';
import { SheetMusic } from './components/SheetMusic/SheetMusic';
import { PianoKeyboard } from './components/PianoKeyboard/PianoKeyboard';
import { useAudioEngine } from './hooks/useAudioEngine';
import { useMidiFile } from './hooks/useMidiFile';
import { useMidiStore } from './stores/midiStore';
import './App.css';

function App() {
  const { noteOn, noteOff, resumeAudio } = useAudioEngine();
  const { handleDrop, currentFile } = useMidiFile();
  const { settings } = useMidiStore();

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  // Handle key press on virtual piano
  const handleNoteOn = useCallback(
    async (noteNumber: number) => {
      await resumeAudio();
      noteOn(noteNumber, 100);
    },
    [noteOn, resumeAudio]
  );

  const handleNoteOff = useCallback(
    (noteNumber: number) => {
      noteOff(noteNumber);
    },
    [noteOff]
  );

  // Handle drag over
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  return (
    <div
      className="app"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <Controls />

      <div className="main-content">
        {currentFile && settings.showSheetMusic && (
          <SheetMusic />
        )}

        {currentFile && settings.showFallingNotes && !settings.showSheetMusic && (
          <FallingNotes lookahead={3} />
        )}

        {!currentFile && (
          <div className="empty-state">
            <p>Drop a MIDI file here or click "Open MIDI" to get started</p>
          </div>
        )}
      </div>

      <PianoKeyboard
        height={120}
        onNoteOn={handleNoteOn}
        onNoteOff={handleNoteOff}
      />
    </div>
  );
}

export default App;
