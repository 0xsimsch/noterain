import { useEffect, useRef, useCallback, useState } from 'react';
import * as Tone from 'tone';
import { useMidiStore } from '../stores/midiStore';
import { getNoteNameFromNumber } from '../types/midi';

/**
 * Salamander Grand Piano V3 - Multi-velocity sampling
 * 5 velocity layers for realistic dynamics (layers 1, 4, 8, 12, 16)
 * Samples served locally from /samples/piano/
 */

/** Velocity layers to load (1=softest, 16=loudest) */
const VELOCITY_LAYERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] as const;

/** Default velocity layer for initial load (medium velocity) */
const DEFAULT_VELOCITY_LAYER = 8;

/** Map MIDI velocity (0-127) to the closest velocity layer */
function getVelocityLayer(velocity: number): number {
  // Quadratic curve: requires stronger hits for higher layers
  // velocity 64 → layer 4, velocity 96 → layer 9, velocity 113 → layer 13
  const normalized = velocity / 127;
  const curved = normalized * normalized;
  const layer = Math.ceil(curved * 16);
  return Math.max(1, Math.min(16, layer));
}

/** Get the best available layer from loaded layers */
function getBestAvailableLayer(velocity: number, loadedLayers: Set<number>): number {
  const idealLayer = getVelocityLayer(velocity);
  if (loadedLayers.has(idealLayer)) return idealLayer;

  // Find nearest loaded layer
  let nearest = DEFAULT_VELOCITY_LAYER;
  let minDistance = Math.abs(idealLayer - nearest);

  for (const layer of loadedLayers) {
    const distance = Math.abs(idealLayer - layer);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = layer;
    }
  }

  return nearest;
}

/** Sample notes available in Salamander (every minor third) */
const SAMPLE_NOTES = [
  'A0', 'C1', 'Ds1', 'Fs1', 'A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3',
  'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5',
  'A5', 'C6', 'Ds6', 'Fs6', 'A6', 'C7', 'Ds7', 'Fs7', 'A7', 'C8',
];

/** Get base URL for a velocity layer */
function getBaseUrl(velocityLayer: number): string {
  return `/samples/piano/v${velocityLayer}/`;
}

/** Loading phases */
type LoadingPhase = 'downloading' | 'decoding' | 'done';

/** Hook for audio playback using Tone.js with multi-velocity sampling */
export function useAudioEngine() {
  const { settings, liveNotes } = useMidiStore();

  // Map of velocity layer -> Sampler instance
  const samplersRef = useRef<Map<number, Tone.Sampler>>(new Map());
  // Track which sampler is playing each note (for proper release)
  const activeNoteSamplersRef = useRef<Map<number, number>>(new Map());
  const isLoadedRef = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>('downloading');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [decodeProgress, setDecodeProgress] = useState(0);
  const loadedCountRef = useRef(0);

  // Track loaded velocity layers
  const loadedLayersRef = useRef<Set<number>>(new Set());
  const [isLoadingFullVelocity, setIsLoadingFullVelocity] = useState(false);
  const [fullVelocityProgress, setFullVelocityProgress] = useState(0);
  const fullVelocityAbortRef = useRef<AbortController | null>(null);
  // Blob URL cache shared between initial and on-demand loading
  const blobUrlCacheRef = useRef<Map<string, string>>(new Map());

  // Sustain pedal state
  const sustainRef = useRef(false);
  const sustainedNotesRef = useRef<Set<number>>(new Set());

  // Initialize with only the default velocity layer for fast initial load
  useEffect(() => {
    const samplers = new Map<number, Tone.Sampler>();
    // Reset counters on each mount (important for React Strict Mode)
    loadedCountRef.current = 0;
    isLoadedRef.current = false;
    loadedLayersRef.current = new Set();

    let downloadedCount = 0;
    let aborted = false;
    const initialSampleCount = SAMPLE_NOTES.length; // Only 30 samples for layer 8

    async function loadInitialLayer() {
      // Phase 1: Download only the default velocity layer
      console.log(`[AudioEngine] Downloading ${initialSampleCount} samples (layer ${DEFAULT_VELOCITY_LAYER})...`);

      const downloadPromises: Promise<void>[] = [];
      const layer = DEFAULT_VELOCITY_LAYER;

      for (const note of SAMPLE_NOTES) {
        const url = `${getBaseUrl(layer)}${note}v${layer}.mp3`;
        const promise = fetch(url)
          .then(response => {
            if (!response.ok) throw new Error(`Failed to fetch ${url}`);
            return response.blob();
          })
          .then(blob => {
            if (aborted) return;
            const blobUrl = URL.createObjectURL(blob);
            blobUrlCacheRef.current.set(url, blobUrl);
            downloadedCount++;
            setDownloadProgress(downloadedCount);
          })
          .catch(err => {
            console.warn(`[AudioEngine] Failed to download ${url}:`, err);
            downloadedCount++;
            setDownloadProgress(downloadedCount);
          });
        downloadPromises.push(promise);
      }

      await Promise.all(downloadPromises);

      if (aborted) return;

      // Phase 2: Decode the default layer with Tone.js
      console.log('[AudioEngine] Initial samples downloaded, decoding...');
      setLoadingPhase('decoding');

      // Build URLs using blob cache
      const urls: Record<string, string> = {};
      for (const note of SAMPLE_NOTES) {
        const originalUrl = `${getBaseUrl(layer)}${note}v${layer}.mp3`;
        const blobUrl = blobUrlCacheRef.current.get(originalUrl);
        const toneNote = note.replace('Ds', 'D#').replace('Fs', 'F#');
        urls[toneNote] = blobUrl || originalUrl;
      }

      const sampler = new Tone.Sampler({
        urls,
        onload: () => {
          if (aborted) return;
          loadedCountRef.current = 1;
          setDecodeProgress(1);
          console.log(`[AudioEngine] Default velocity layer ${layer} ready`);
          loadedLayersRef.current.add(layer);
          isLoadedRef.current = true;
          setLoadingPhase('done');
          setIsLoading(false);
        },
        onerror: (err) => {
          console.warn(`[AudioEngine] Failed to decode velocity layer ${layer}:`, err);
        },
      }).toDestination();

      samplers.set(layer, sampler);
      samplersRef.current = samplers;
    }

    loadInitialLayer();

    return () => {
      aborted = true;
      // Abort any ongoing full velocity load
      fullVelocityAbortRef.current?.abort();
      for (const sampler of samplersRef.current.values()) {
        sampler.dispose();
      }
      // Clean up blob URLs
      for (const blobUrl of blobUrlCacheRef.current.values()) {
        URL.revokeObjectURL(blobUrl);
      }
      blobUrlCacheRef.current.clear();
    };
  }, []);

  // Load remaining velocity layers when playMidiInputAudio is enabled
  useEffect(() => {
    // Only trigger on-demand loading when playMidiInputAudio is enabled
    if (!settings.playMidiInputAudio) {
      // Abort any ongoing load if user disables the setting
      if (fullVelocityAbortRef.current) {
        fullVelocityAbortRef.current.abort();
        fullVelocityAbortRef.current = null;
        setIsLoadingFullVelocity(false);
      }
      return;
    }

    // Check if all layers are already loaded
    if (loadedLayersRef.current.size === VELOCITY_LAYERS.length) {
      return;
    }

    // Don't start if initial load isn't complete yet
    if (!isLoadedRef.current) {
      return;
    }

    const abortController = new AbortController();
    fullVelocityAbortRef.current = abortController;

    async function loadRemainingLayers() {
      const remainingLayers = VELOCITY_LAYERS.filter(
        layer => !loadedLayersRef.current.has(layer)
      );

      if (remainingLayers.length === 0) return;

      console.log(`[AudioEngine] Loading ${remainingLayers.length} remaining velocity layers...`);
      setIsLoadingFullVelocity(true);
      setFullVelocityProgress(0);

      let loadedCount = 0;
      const totalRemaining = remainingLayers.length;

      for (const layer of remainingLayers) {
        if (abortController.signal.aborted) {
          console.log('[AudioEngine] On-demand loading aborted');
          setIsLoadingFullVelocity(false);
          return;
        }

        // Download samples for this layer
        const downloadPromises: Promise<void>[] = [];

        for (const note of SAMPLE_NOTES) {
          const url = `${getBaseUrl(layer)}${note}v${layer}.mp3`;
          // Skip if already cached
          if (blobUrlCacheRef.current.has(url)) continue;

          const promise = fetch(url, { signal: abortController.signal })
            .then(response => {
              if (!response.ok) throw new Error(`Failed to fetch ${url}`);
              return response.blob();
            })
            .then(blob => {
              if (abortController.signal.aborted) return;
              const blobUrl = URL.createObjectURL(blob);
              blobUrlCacheRef.current.set(url, blobUrl);
            })
            .catch(err => {
              if (err.name !== 'AbortError') {
                console.warn(`[AudioEngine] Failed to download ${url}:`, err);
              }
            });
          downloadPromises.push(promise);
        }

        await Promise.all(downloadPromises);

        if (abortController.signal.aborted) return;

        // Build URLs and create sampler
        const urls: Record<string, string> = {};
        for (const note of SAMPLE_NOTES) {
          const originalUrl = `${getBaseUrl(layer)}${note}v${layer}.mp3`;
          const blobUrl = blobUrlCacheRef.current.get(originalUrl);
          const toneNote = note.replace('Ds', 'D#').replace('Fs', 'F#');
          urls[toneNote] = blobUrl || originalUrl;
        }

        // Wait for sampler to decode
        await new Promise<void>((resolve, reject) => {
          if (abortController.signal.aborted) {
            reject(new Error('Aborted'));
            return;
          }

          const sampler = new Tone.Sampler({
            urls,
            onload: () => {
              if (abortController.signal.aborted) {
                sampler.dispose();
                resolve();
                return;
              }
              samplersRef.current.set(layer, sampler);
              loadedLayersRef.current.add(layer);
              loadedCount++;
              setFullVelocityProgress(loadedCount / totalRemaining);
              console.log(`[AudioEngine] Velocity layer ${layer} loaded (${loadedCount}/${totalRemaining})`);
              resolve();
            },
            onerror: (err) => {
              console.warn(`[AudioEngine] Failed to decode velocity layer ${layer}:`, err);
              resolve(); // Continue with other layers
            },
          }).toDestination();

          // Apply current volume to new sampler
          const db = settings.audioEnabled
            ? Tone.gainToDb(settings.volume)
            : -Infinity;
          sampler.volume.value = db;
        }).catch(() => {
          // Aborted
        });
      }

      if (!abortController.signal.aborted) {
        console.log('[AudioEngine] All velocity layers loaded');
        setIsLoadingFullVelocity(false);
        fullVelocityAbortRef.current = null;
      }
    }

    loadRemainingLayers();

    return () => {
      abortController.abort();
    };
  }, [settings.playMidiInputAudio, settings.audioEnabled, settings.volume]);

  // Update volume on all samplers
  useEffect(() => {
    const db = settings.audioEnabled
      ? Tone.gainToDb(settings.volume)
      : -Infinity;

    for (const sampler of samplersRef.current.values()) {
      sampler.volume.value = db;
    }
  }, [settings.volume, settings.audioEnabled]);

  // Play live notes from MIDI input
  useEffect(() => {
    if (!settings.audioEnabled || !isLoadedRef.current) {
      return;
    }
    // Notes are triggered in the MIDI input handler
  }, [liveNotes, settings.audioEnabled]);

  /** Play a single note with velocity-appropriate sample */
  const playNote = useCallback(
    (noteNumber: number, velocity: number = 100, duration: number = 0.5) => {
      if (!settings.audioEnabled) {
        console.log('[AudioEngine] Audio disabled, skipping note');
        return;
      }
      if (!isLoadedRef.current) {
        console.log('[AudioEngine] Samples not loaded yet, skipping note');
        return;
      }

      const layer = getBestAvailableLayer(velocity, loadedLayersRef.current);
      const sampler = samplersRef.current.get(layer);
      if (!sampler) {
        console.warn('[AudioEngine] No sampler for layer:', layer);
        return;
      }

      const noteName = getNoteNameFromNumber(noteNumber);

      try {
        sampler.triggerAttackRelease(noteName, duration, Tone.now());
      } catch (e) {
        console.warn('Failed to play note:', e);
      }
    },
    [settings.audioEnabled]
  );

  /** Start a note (for sustained playing) with velocity-appropriate sample */
  const noteOn = useCallback(
    (noteNumber: number, velocity: number = 100) => {
      if (!settings.audioEnabled || !isLoadedRef.current) {
        return;
      }

      const layer = getBestAvailableLayer(velocity, loadedLayersRef.current);
      const sampler = samplersRef.current.get(layer);
      if (!sampler) return;

      const noteName = getNoteNameFromNumber(noteNumber);

      try {
        sampler.triggerAttack(noteName, Tone.now());
        // Track which sampler is playing this note
        activeNoteSamplersRef.current.set(noteNumber, layer);
      } catch (e) {
        console.warn('Failed to trigger note on:', e);
      }
    },
    [settings.audioEnabled]
  );

  /** Stop a note (respects sustain pedal) */
  const noteOff = useCallback(
    (noteNumber: number) => {
      if (!isLoadedRef.current) {
        return;
      }

      // If sustain pedal is held, don't release the note yet
      if (sustainRef.current) {
        sustainedNotesRef.current.add(noteNumber);
        return;
      }

      const layer = activeNoteSamplersRef.current.get(noteNumber);
      if (layer === undefined) return;

      const sampler = samplersRef.current.get(layer);
      if (!sampler) return;

      const noteName = getNoteNameFromNumber(noteNumber);

      try {
        sampler.triggerRelease(noteName, Tone.now());
        activeNoteSamplersRef.current.delete(noteNumber);
      } catch (e) {
        console.warn('Failed to trigger note off:', e);
      }
    },
    []
  );

  /** Stop all notes on all samplers */
  const stopAll = useCallback(() => {
    for (const sampler of samplersRef.current.values()) {
      sampler.releaseAll();
    }
    activeNoteSamplersRef.current.clear();
    sustainedNotesRef.current.clear();
  }, []);

  /** Set sustain pedal state */
  const setSustain = useCallback((isPressed: boolean) => {
    sustainRef.current = isPressed;

    // When pedal is released, release all sustained notes
    if (!isPressed && isLoadedRef.current) {
      for (const noteNumber of sustainedNotesRef.current) {
        const layer = activeNoteSamplersRef.current.get(noteNumber);
        if (layer === undefined) continue;

        const sampler = samplersRef.current.get(layer);
        if (!sampler) continue;

        const noteName = getNoteNameFromNumber(noteNumber);
        try {
          sampler.triggerRelease(noteName, Tone.now());
          activeNoteSamplersRef.current.delete(noteNumber);
        } catch (e) {
          console.warn('Failed to release sustained note:', e);
        }
      }
      sustainedNotesRef.current.clear();
    }
  }, []);

  /** Resume audio context (required after user interaction) */
  const resumeAudio = useCallback(async () => {
    if (Tone.context.state !== 'running') {
      await Tone.start();
    }
  }, []);

  return {
    playNote,
    noteOn,
    noteOff,
    stopAll,
    setSustain,
    resumeAudio,
    isLoaded: isLoadedRef.current,
    isLoading,
    loadingPhase,
    downloadProgress,
    decodeProgress,
    totalSamples: SAMPLE_NOTES.length, // Only initial layer
    totalLayers: 1, // Only counting initial layer for loading screen
    isLoadingFullVelocity,
    fullVelocityProgress,
  };
}
