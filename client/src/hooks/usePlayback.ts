import { useEffect, useRef, useCallback } from 'react';
import { useMidiStore, getActiveNotesAtTime } from '../stores/midiStore';
import { useAudioEngine } from './useAudioEngine';

/** Hook for MIDI playback control */
export function usePlayback() {
  const {
    playback,
    play,
    pause,
    stop,
    seek,
    setSpeed,
    toggleWaitMode,
    setActiveNotes,
    getCurrentFile,
    liveNotes,
  } = useMidiStore();

  const { playNote, stopAll, resumeAudio } = useAudioEngine();

  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const scheduledNotesRef = useRef<Set<string>>(new Set());
  // Track current playback time in ref to avoid stale closure in tick()
  const currentTimeRef = useRef<number>(0);

  // Main playback loop
  useEffect(() => {
    console.log('[Playback] Effect triggered, isPlaying:', playback.isPlaying);

    if (!playback.isPlaying) {
      console.log('[Playback] Not playing, cleaning up animation frame');
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const initialFile = getCurrentFile();
    if (!initialFile) {
      console.log('[Playback] No file loaded, pausing');
      pause();
      return;
    }

    console.log('[Playback] Starting playback loop, file duration:', initialFile.duration);
    lastTimeRef.current = performance.now();
    // Initialize currentTimeRef from store
    currentTimeRef.current = useMidiStore.getState().playback.currentTime;

    const tick = () => {
      // Read fresh file data each tick to pick up track enabled changes
      const state = useMidiStore.getState();
      const file = state.files.find((f) => f.id === state.currentFileId);
      if (!file) {
        stop();
        return;
      }

      const now = performance.now();
      const deltaMs = now - lastTimeRef.current;
      lastTimeRef.current = now;

      // Calculate new time using ref (not stale closure)
      const speed = state.playback.speed;
      const deltaSeconds = (deltaMs / 1000) * speed;
      const prevTime = currentTimeRef.current;
      const newTime = prevTime + deltaSeconds;
      currentTimeRef.current = newTime;

      // Debug log every ~60 frames (roughly once per second at 60fps)
      if (Math.random() < 0.016) {
        console.log('[Playback] tick - deltaMs:', deltaMs.toFixed(2), 'newTime:', newTime.toFixed(3), 'speed:', speed);
      }

      // Check if we've reached the end
      if (newTime >= file.duration) {
        stop();
        return;
      }

      // Get notes that should be playing now (respects track.enabled)
      const activeNotes = getActiveNotesAtTime(file, newTime);
      const activeNoteNumbers = new Set(activeNotes.map((n) => n.noteNumber));

      // Find newly started notes
      for (const track of file.tracks) {
        if (!track.enabled) continue;

        for (const note of track.notes) {
          const noteKey = `${note.track}-${note.noteNumber}-${note.startTime}`;

          // Note just started
          if (
            note.startTime > prevTime &&
            note.startTime <= newTime &&
            !scheduledNotesRef.current.has(noteKey)
          ) {
            scheduledNotesRef.current.add(noteKey);
            console.log('[Playback] Playing note:', note.noteNumber, 'at time:', note.startTime.toFixed(3));
            playNote(note.noteNumber, note.velocity, note.duration);
          }

          // Clean up old notes from tracking
          if (note.startTime + note.duration < newTime) {
            scheduledNotesRef.current.delete(noteKey);
          }
        }
      }

      // Update state
      setActiveNotes(activeNoteNumbers);
      seek(newTime);

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
    // Note: playback.currentTime and playback.speed are intentionally excluded -
    // they're read via useMidiStore.getState() inside tick() to avoid stale closures
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    playback.isPlaying,
    getCurrentFile,
    pause,
    stop,
    seek,
    setActiveNotes,
    playNote,
  ]);

  // Reset scheduled notes when stopping
  useEffect(() => {
    if (!playback.isPlaying) {
      scheduledNotesRef.current.clear();
    }
  }, [playback.isPlaying]);

  // Handle wait mode - pause when waiting for correct note
  useEffect(() => {
    if (!playback.isPlaying || !playback.waitMode) return;

    const file = getCurrentFile();
    if (!file) return;

    const activeNotes = getActiveNotesAtTime(file, playback.currentTime);

    if (activeNotes.length > 0) {
      // Check if all required notes are being played
      const requiredNotes = new Set(activeNotes.map((n) => n.noteNumber));
      const allPlayed = [...requiredNotes].every((note) => liveNotes.has(note));

      if (!allPlayed) {
        // Pause and wait
        // This will be handled by not advancing time until notes are played
      }
    }
  }, [playback.isPlaying, playback.waitMode, playback.currentTime, liveNotes, getCurrentFile]);

  /** Toggle play/pause */
  const togglePlay = useCallback(async () => {
    console.log('[Playback] togglePlay called, current isPlaying:', playback.isPlaying);
    await resumeAudio();

    if (playback.isPlaying) {
      console.log('[Playback] Pausing playback');
      stopAll();
      pause();
    } else {
      console.log('[Playback] Starting playback');
      play();
    }
  }, [playback.isPlaying, play, pause, stopAll, resumeAudio]);

  /** Stop playback and reset */
  const handleStop = useCallback(() => {
    stopAll();
    stop();
  }, [stop, stopAll]);

  /** Seek to position (0-1) */
  const seekToPercent = useCallback(
    (percent: number) => {
      const file = getCurrentFile();
      if (!file) return;
      seek(file.duration * Math.max(0, Math.min(1, percent)));
    },
    [getCurrentFile, seek]
  );

  /** Get current progress (0-1) */
  const getProgress = useCallback(() => {
    const file = getCurrentFile();
    if (!file || file.duration === 0) return 0;
    return playback.currentTime / file.duration;
  }, [getCurrentFile, playback.currentTime]);

  return {
    isPlaying: playback.isPlaying,
    currentTime: playback.currentTime,
    speed: playback.speed,
    waitMode: playback.waitMode,
    activeNotes: playback.activeNotes,
    togglePlay,
    stop: handleStop,
    seek,
    seekToPercent,
    setSpeed,
    toggleWaitMode,
    getProgress,
  };
}
