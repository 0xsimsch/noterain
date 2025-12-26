import type { MidiFile } from '../types/midi';

const RAW_DATA_PREFIX = 'piano-midi-raw-';

/** Save raw MIDI data separately (too large for main storage) */
export function saveRawMidiData(fileId: string, data: ArrayBuffer): void {
  try {
    const base64 = arrayBufferToBase64(data);
    localStorage.setItem(`${RAW_DATA_PREFIX}${fileId}`, base64);
  } catch (error) {
    console.warn('Failed to save raw MIDI data:', error);
  }
}

/** Load raw MIDI data */
export function loadRawMidiData(fileId: string): ArrayBuffer | null {
  try {
    const base64 = localStorage.getItem(`${RAW_DATA_PREFIX}${fileId}`);
    if (!base64) return null;
    return base64ToArrayBuffer(base64);
  } catch (error) {
    console.warn('Failed to load raw MIDI data:', error);
    return null;
  }
}

/** Remove raw MIDI data */
export function removeRawMidiData(fileId: string): void {
  localStorage.removeItem(`${RAW_DATA_PREFIX}${fileId}`);
}

/** Convert ArrayBuffer to base64 string */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Convert base64 string to ArrayBuffer */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** Generate unique ID */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/** Export MIDI file as downloadable .mid file */
export function downloadMidiFile(file: MidiFile): void {
  const rawData = loadRawMidiData(file.id);
  if (!rawData) {
    console.error('No raw data available for export');
    return;
  }

  const blob = new Blob([rawData], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name.endsWith('.mid') ? file.name : `${file.name}.mid`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Get storage usage info */
export function getStorageInfo(): { used: number; available: number } {
  let used = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) {
      const value = localStorage.getItem(key);
      if (value) {
        used += key.length + value.length;
      }
    }
  }
  // localStorage typically has 5-10MB limit
  const available = 5 * 1024 * 1024 - used;
  return { used, available };
}
