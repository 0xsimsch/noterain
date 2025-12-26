import { useCallback } from 'react';
import { useMidiStore } from '../stores/midiStore';
import { parseMidiFile, createEmptyMidiFile, exportToMidi } from '../lib/midi/parser';
import { removeRawMidiData } from '../utils/storage';
import type { MidiFile } from '../types/midi';

/** Hook for MIDI file operations */
export function useMidiFile() {
  const {
    files,
    currentFileId,
    addFile,
    removeFile,
    updateFile,
    setCurrentFile,
    getCurrentFile,
  } = useMidiStore();

  /** Load a MIDI file from File object */
  const loadFile = useCallback(
    async (file: File): Promise<MidiFile> => {
      const arrayBuffer = await file.arrayBuffer();
      const midiFile = parseMidiFile(arrayBuffer, file.name);
      addFile(midiFile);
      setCurrentFile(midiFile.id);
      return midiFile;
    },
    [addFile, setCurrentFile]
  );

  /** Load a MIDI file from URL */
  const loadFromUrl = useCallback(
    async (url: string, name?: string): Promise<MidiFile> => {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const fileName = name || url.split('/').pop() || 'Untitled.mid';
      const midiFile = parseMidiFile(arrayBuffer, fileName);
      addFile(midiFile);
      setCurrentFile(midiFile.id);
      return midiFile;
    },
    [addFile, setCurrentFile]
  );

  /** Create a new empty MIDI file */
  const createNew = useCallback(
    (name: string = 'Untitled'): MidiFile => {
      const midiFile = createEmptyMidiFile(name);
      addFile(midiFile);
      setCurrentFile(midiFile.id);
      return midiFile;
    },
    [addFile, setCurrentFile]
  );

  /** Delete a MIDI file */
  const deleteFile = useCallback(
    (id: string) => {
      removeRawMidiData(id);
      removeFile(id);
    },
    [removeFile]
  );

  /** Export current file as .mid download */
  const exportFile = useCallback(
    (file?: MidiFile) => {
      const targetFile = file || getCurrentFile();
      if (!targetFile) return;

      // Generate fresh MIDI data from internal format
      const midiData = exportToMidi(targetFile);
      const blob = new Blob([new Uint8Array(midiData)], { type: 'audio/midi' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = targetFile.name.endsWith('.mid')
        ? targetFile.name
        : `${targetFile.name}.mid`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    [getCurrentFile]
  );

  /** Handle file drop */
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const droppedFiles = Array.from(e.dataTransfer.files).filter(
        (f) => f.name.endsWith('.mid') || f.name.endsWith('.midi')
      );

      for (const file of droppedFiles) {
        await loadFile(file);
      }
    },
    [loadFile]
  );

  /** Handle file input change */
  const handleFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(e.target.files || []).filter(
        (f) => f.name.endsWith('.mid') || f.name.endsWith('.midi')
      );

      for (const file of selectedFiles) {
        await loadFile(file);
      }

      // Reset input
      e.target.value = '';
    },
    [loadFile]
  );

  return {
    files,
    currentFile: getCurrentFile(),
    currentFileId,
    loadFile,
    loadFromUrl,
    createNew,
    deleteFile,
    updateFile,
    setCurrentFile,
    exportFile,
    handleDrop,
    handleFileInput,
  };
}
