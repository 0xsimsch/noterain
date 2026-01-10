import { useEffect, useRef, useCallback, useState } from 'react';
import * as Tone from 'tone';
import { useMidiStore } from '../stores/midiStore';
import { getNoteNameFromNumber } from '../types/midi';

/** Common interface for synth/sampler */
type Instrument = Tone.PolySynth | Tone.Sampler;

/** Sample configuration for each piano sound */
interface SampleConfig {
  baseUrl: string;
  urls: Record<string, string>;
}

/** Piano sample configuration */
const PIANO_SAMPLES: SampleConfig = {
  baseUrl: 'https://nbrosowsky.github.io/tonejs-instruments/samples/piano/',
  urls: {
    A1: 'A1.mp3',
    A2: 'A2.mp3',
    A3: 'A3.mp3',
    A4: 'A4.mp3',
    A5: 'A5.mp3',
    A6: 'A6.mp3',
    C2: 'C2.mp3',
    C3: 'C3.mp3',
    C4: 'C4.mp3',
    C5: 'C5.mp3',
    C6: 'C6.mp3',
    C7: 'C7.mp3',
    'D#2': 'Ds2.mp3',
    'D#3': 'Ds3.mp3',
    'D#4': 'Ds4.mp3',
    'D#5': 'Ds5.mp3',
    'D#6': 'Ds6.mp3',
    'F#2': 'Fs2.mp3',
    'F#3': 'Fs3.mp3',
    'F#4': 'Fs4.mp3',
    'F#5': 'Fs5.mp3',
    'F#6': 'Fs6.mp3',
  },
};

/** Hook for audio playback using Tone.js */
export function useAudioEngine() {
  const { settings, liveNotes } = useMidiStore();
  const samplerRef = useRef<Instrument | null>(null);
  const isLoadedRef = useRef(false);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize piano samples
  useEffect(() => {
    const sampler = new Tone.Sampler({
      urls: PIANO_SAMPLES.urls,
      baseUrl: PIANO_SAMPLES.baseUrl,
      onload: () => {
        console.log('[AudioEngine] Piano samples loaded');
        isLoadedRef.current = true;
        setIsLoading(false);
      },
      onerror: (err) => {
        console.warn('[AudioEngine] Failed to load piano samples:', err);
        setIsLoading(false);
      },
    }).toDestination();

    samplerRef.current = sampler;

    return () => {
      sampler.dispose();
    };
  }, []);

  // Update volume
  useEffect(() => {
    if (samplerRef.current) {
      const db = settings.audioEnabled
        ? Tone.gainToDb(settings.volume)
        : -Infinity;
      samplerRef.current.volume.value = db;
    }
  }, [settings.volume, settings.audioEnabled]);

  // Play live notes from MIDI input
  useEffect(() => {
    if (!settings.audioEnabled || !samplerRef.current || !isLoadedRef.current) {
      return;
    }

    // This effect runs when liveNotes changes
    // Notes are triggered in the MIDI input handler
  }, [liveNotes, settings.audioEnabled]);

  /** Play a single note */
  const playNote = useCallback(
    (noteNumber: number, velocity: number = 100, duration: number = 0.5) => {
      if (!settings.audioEnabled || !samplerRef.current || !isLoadedRef.current) {
        return;
      }

      const noteName = getNoteNameFromNumber(noteNumber);
      const velocityNormalized = velocity / 127;

      try {
        samplerRef.current.triggerAttackRelease(
          noteName,
          duration,
          Tone.now(),
          velocityNormalized
        );
      } catch (e) {
        console.warn('Failed to play note:', e);
      }
    },
    [settings.audioEnabled]
  );

  /** Start a note (for sustained playing) */
  const noteOn = useCallback(
    (noteNumber: number, velocity: number = 100) => {
      if (!settings.audioEnabled || !samplerRef.current || !isLoadedRef.current) {
        return;
      }

      const noteName = getNoteNameFromNumber(noteNumber);
      const velocityNormalized = velocity / 127;

      try {
        samplerRef.current.triggerAttack(noteName, Tone.now(), velocityNormalized);
      } catch (e) {
        console.warn('Failed to trigger note on:', e);
      }
    },
    [settings.audioEnabled]
  );

  /** Stop a note */
  const noteOff = useCallback(
    (noteNumber: number) => {
      if (!samplerRef.current || !isLoadedRef.current) {
        return;
      }

      const noteName = getNoteNameFromNumber(noteNumber);

      try {
        samplerRef.current.triggerRelease(noteName, Tone.now());
      } catch (e) {
        console.warn('Failed to trigger note off:', e);
      }
    },
    []
  );

  /** Stop all notes */
  const stopAll = useCallback(() => {
    if (!samplerRef.current) return;
    samplerRef.current.releaseAll();
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
    resumeAudio,
    isLoaded: isLoadedRef.current,
    isLoading,
  };
}
