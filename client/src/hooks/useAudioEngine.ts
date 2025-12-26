import { useEffect, useRef, useCallback } from 'react';
import * as Tone from 'tone';
import { useMidiStore } from '../stores/midiStore';
import { getNoteNameFromNumber } from '../types/midi';

/** Common interface for synth/sampler */
type Instrument = Tone.PolySynth | Tone.Sampler;

/** Hook for audio playback using Tone.js */
export function useAudioEngine() {
  const { settings, liveNotes } = useMidiStore();
  const samplerRef = useRef<Instrument | null>(null);
  const isLoadedRef = useRef(false);

  // Initialize Tone.js sampler
  useEffect(() => {
    // Use built-in synth initially (sampler loading takes time)
    const synth = new Tone.PolySynth(Tone.Synth, {
      envelope: {
        attack: 0.005,
        decay: 0.1,
        sustain: 0.3,
        release: 1,
      },
    }).toDestination();

    // For now, use a simple synth. In production, load a proper piano sampler:
    // const sampler = new Tone.Sampler({
    //   urls: {
    //     A0: "A0.mp3",
    //     C1: "C1.mp3",
    //     // ... more samples
    //   },
    //   baseUrl: "https://tonejs.github.io/audio/salamander/",
    //   onload: () => { isLoadedRef.current = true; }
    // }).toDestination();

    samplerRef.current = synth;
    isLoadedRef.current = true;

    return () => {
      synth.dispose();
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
  };
}
