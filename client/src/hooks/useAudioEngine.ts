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

/** Map MIDI velocity (0-127) to the closest velocity layer */
function getVelocityLayer(velocity: number): number {
  // Quadratic curve: requires stronger hits for higher layers
  // velocity 64 → layer 4, velocity 96 → layer 9, velocity 113 → layer 13
  const normalized = velocity / 127;
  const curved = normalized * normalized;
  const layer = Math.ceil(curved * 16);
  return Math.max(1, Math.min(16, layer));
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

/** Total number of sample files */
const TOTAL_SAMPLES = VELOCITY_LAYERS.length * SAMPLE_NOTES.length;

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

  // Sustain pedal state
  const sustainRef = useRef(false);
  const sustainedNotesRef = useRef<Set<number>>(new Set());

  // Initialize all velocity layer samplers with pre-fetching
  useEffect(() => {
    const samplers = new Map<number, Tone.Sampler>();
    // Reset counters on each mount (important for React Strict Mode)
    loadedCountRef.current = 0;
    isLoadedRef.current = false;

    // Cache for downloaded blob URLs
    const blobUrlCache = new Map<string, string>();
    let downloadedCount = 0;
    let aborted = false;

    async function loadSamples() {
      // Phase 1: Download all samples
      console.log(`[AudioEngine] Downloading ${TOTAL_SAMPLES} samples...`);

      const downloadPromises: Promise<void>[] = [];

      for (const layer of VELOCITY_LAYERS) {
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
              blobUrlCache.set(url, blobUrl);
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
      }

      await Promise.all(downloadPromises);

      if (aborted) return;

      // Phase 2: Decode samples with Tone.js
      console.log('[AudioEngine] All samples downloaded, decoding...');
      setLoadingPhase('decoding');

      for (const layer of VELOCITY_LAYERS) {
        if (aborted) return;

        // Build URLs using blob cache
        const urls: Record<string, string> = {};
        for (const note of SAMPLE_NOTES) {
          const originalUrl = `${getBaseUrl(layer)}${note}v${layer}.mp3`;
          const blobUrl = blobUrlCache.get(originalUrl);
          const toneNote = note.replace('Ds', 'D#').replace('Fs', 'F#');
          urls[toneNote] = blobUrl || originalUrl;
        }

        const sampler = new Tone.Sampler({
          urls,
          onload: () => {
            if (aborted) return;
            loadedCountRef.current++;
            setDecodeProgress(loadedCountRef.current);
            console.log(`[AudioEngine] Velocity layer ${layer} decoded (${loadedCountRef.current}/${VELOCITY_LAYERS.length})`);

            if (loadedCountRef.current === VELOCITY_LAYERS.length) {
              console.log('[AudioEngine] All velocity layers ready');
              isLoadedRef.current = true;
              setLoadingPhase('done');
              setIsLoading(false);
            }
          },
          onerror: (err) => {
            console.warn(`[AudioEngine] Failed to decode velocity layer ${layer}:`, err);
          },
        }).toDestination();

        samplers.set(layer, sampler);
      }

      samplersRef.current = samplers;
    }

    loadSamples();

    return () => {
      aborted = true;
      for (const sampler of samplersRef.current.values()) {
        sampler.dispose();
      }
      // Clean up blob URLs
      for (const blobUrl of blobUrlCache.values()) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, []);

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

      const layer = getVelocityLayer(velocity);
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

      const layer = getVelocityLayer(velocity);
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
    totalSamples: TOTAL_SAMPLES,
    totalLayers: VELOCITY_LAYERS.length,
  };
}
