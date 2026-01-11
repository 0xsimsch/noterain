import { useCallback, useEffect, useMemo } from 'react';
import { Controls } from './components/Controls/Controls';
import { FallingNotes } from './components/FallingNotes/FallingNotes';
import { SheetMusic } from './components/SheetMusic/SheetMusic';
import { PianoKeyboard } from './components/PianoKeyboard/PianoKeyboard';
import { useAudioEngine } from './hooks/useAudioEngine';
import { useMidiFile } from './hooks/useMidiFile';
import { useMidiStore, calculateNoteRange } from './stores/midiStore';
import './App.css';

function App() {
  const { noteOn, noteOff, resumeAudio } = useAudioEngine();
  const { handleDrop, currentFile } = useMidiFile();
  const { settings, setLiveNote, addSatisfiedWaitNote } = useMidiStore();

  // Calculate dynamic note range based on enabled tracks (only when fitKeyboardToSong is enabled)
  const { minNote, maxNote } = useMemo(
    () => settings.fitKeyboardToSong ? calculateNoteRange(currentFile, 2) : calculateNoteRange(null, 2),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentFile, currentFile?.tracks, settings.fitKeyboardToSong]
  );

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  // Handle key press on virtual piano
  const handleNoteOn = useCallback(
    async (noteNumber: number) => {
      await resumeAudio();
      noteOn(noteNumber, 100);
      setLiveNote(noteNumber, true);
      addSatisfiedWaitNote(noteNumber);
    },
    [noteOn, resumeAudio, setLiveNote, addSatisfiedWaitNote]
  );

  const handleNoteOff = useCallback(
    (noteNumber: number) => {
      noteOff(noteNumber);
      setLiveNote(noteNumber, false);
    },
    [noteOff, setLiveNote]
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
          <FallingNotes lookahead={3} minNote={minNote} maxNote={maxNote} />
        )}

        {!currentFile && (
          <div className="empty-state">
            <p>Drop a MIDI file here or click "Open MIDI" to get started</p>
          </div>
        )}
      </div>

      <PianoKeyboard
        onNoteOn={handleNoteOn}
        onNoteOff={handleNoteOff}
        minNote={minNote}
        maxNote={maxNote}
      />
    </div>
  );
}

export default App;
