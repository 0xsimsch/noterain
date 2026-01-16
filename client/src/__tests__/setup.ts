/**
 * Vitest setup file - mocks browser APIs for Node.js environment
 */

// Mock localStorage
const localStorageMock = {
  store: {} as Record<string, string>,
  getItem: (key: string) => localStorageMock.store[key] || null,
  setItem: (key: string, value: string) => {
    localStorageMock.store[key] = value;
  },
  removeItem: (key: string) => {
    delete localStorageMock.store[key];
  },
  clear: () => {
    localStorageMock.store = {};
  },
  get length() {
    return Object.keys(this.store).length;
  },
  key: (index: number) => Object.keys(localStorageMock.store)[index] || null,
};

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// Mock performance.now() if not available
if (typeof performance === 'undefined') {
  (globalThis as unknown as { performance: { now: () => number } }).performance = {
    now: () => Date.now(),
  };
}

// Reset store before each test
import { beforeEach } from 'vitest';
import { useMidiStore } from '../stores/midiStore';
import { DEFAULT_SETTINGS } from '../types/midi';

beforeEach(() => {
  localStorageMock.clear();

  // Reset the Zustand store to initial state
  useMidiStore.setState({
    files: [],
    currentFileId: null,
    devices: [],
    selectedInputId: null,
    selectedOutputId: null,
    playback: {
      isPlaying: false,
      currentTime: 0,
      speed: 1,
      waitMode: false,
      activeNotes: new Set(),
      loopEnabled: false,
      loopStartMeasure: null,
      loopEndMeasure: null,
    },
    liveNotes: new Set(),
    // Index-based wait mode state
    waitModeSortedNotes: [],
    waitModeSatisfiedIndices: new Set(),
    waitModeReachedIndex: 0,
    settings: DEFAULT_SETTINGS,
  });
});
