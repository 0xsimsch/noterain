import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Controls } from './components/Controls/Controls';
import { FallingNotes } from './components/FallingNotes/FallingNotes';
import { LoadingScreen } from './components/LoadingScreen/LoadingScreen';
import { NotesOverlay } from './components/NotesOverlay/NotesOverlay';
import { SheetMusic } from './components/SheetMusic/SheetMusic';
import { PianoKeyboard } from './components/PianoKeyboard/PianoKeyboard';
import { useAudioEngine } from './hooks/useAudioEngine';
import { useMidiFile } from './hooks/useMidiFile';
import { useMidiInput } from './hooks/useMidiInput';
import { useMidiStore, calculateNoteRange } from './stores/midiStore';
import './App.css';

function App() {
  const { noteOn, noteOff, setSustain, resumeAudio, isLoading, loadingPhase, downloadProgress, decodeProgress, totalSamples, totalLayers, isLoadingFullVelocity } = useAudioEngine();
  const { handleDrop, currentFile } = useMidiFile();
  const { settings, setLiveNote, addSatisfiedWaitNote } = useMidiStore();

  // Store audio functions in ref to avoid MIDI listener re-subscriptions
  const audioRef = useRef({ noteOn, noteOff, setSustain, resumeAudio, settings, isLoading });
  audioRef.current = { noteOn, noteOff, setSustain, resumeAudio, settings, isLoading };

  // MIDI input callbacks - play audio when hardware MIDI notes are received
  const handleMidiNoteOn = useCallback(async (noteNumber: number, velocity: number) => {
    const { noteOn, resumeAudio, settings, isLoading } = audioRef.current;
    if (isLoading) return; // Block input while loading
    if (settings.playMidiInputAudio) {
      await resumeAudio();
      noteOn(noteNumber, velocity);
    }
  }, []);

  const handleMidiNoteOff = useCallback((noteNumber: number) => {
    const { noteOff, settings, isLoading } = audioRef.current;
    if (isLoading) return; // Block input while loading
    if (settings.playMidiInputAudio) {
      noteOff(noteNumber);
    }
  }, []);

  const handleMidiSustain = useCallback((isPressed: boolean) => {
    const { setSustain, settings, isLoading } = audioRef.current;
    if (isLoading) return; // Block input while loading
    if (settings.playMidiInputAudio) {
      setSustain(isPressed);
    }
  }, []);

  // Initialize MIDI input with audio callbacks
  useMidiInput({
    onNoteOn: handleMidiNoteOn,
    onNoteOff: handleMidiNoteOff,
    onSustain: handleMidiSustain,
  });

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
      if (isLoading) return; // Block input while loading
      await resumeAudio();
      noteOn(noteNumber, 64);
      setLiveNote(noteNumber, true);
      addSatisfiedWaitNote(noteNumber);
    },
    [noteOn, resumeAudio, setLiveNote, addSatisfiedWaitNote, isLoading]
  );

  const handleNoteOff = useCallback(
    (noteNumber: number) => {
      if (isLoading) return; // Block input while loading
      noteOff(noteNumber);
      setLiveNote(noteNumber, false);
    },
    [noteOff, setLiveNote, isLoading]
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
      {isLoading && (
        <LoadingScreen
          phase={loadingPhase}
          downloadProgress={downloadProgress}
          decodeProgress={decodeProgress}
          totalSamples={totalSamples}
          totalLayers={totalLayers}
        />
      )}

      <Controls isLoadingFullVelocity={isLoadingFullVelocity} />

      <div className="main-content">
        {settings.showNotesOverlay && <NotesOverlay />}

        {currentFile && settings.showSheetMusic && (
          <SheetMusic />
        )}

        {currentFile && settings.showFallingNotes && !settings.showSheetMusic && (
          <FallingNotes lookahead={3} minNote={minNote} maxNote={maxNote} />
        )}

        {!currentFile && !isLoading && (
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
