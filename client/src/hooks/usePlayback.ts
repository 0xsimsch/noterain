import { useEffect, useRef, useCallback } from 'react';
import { useMidiStore, getActiveNotesAtTime, getWaitModeNotes } from '../stores/midiStore';
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
    clearSatisfiedWaitNotes,
    pruneStatisfiedWaitNotes,
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

    console.log(
      '[Playback] Starting playback loop, file duration:',
      initialFile.duration,
    );
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

      // Check if user seeked externally (slider) - sync if store time differs significantly
      const storeTime = state.playback.currentTime;
      if (Math.abs(storeTime - currentTimeRef.current) > 0.1) {
        currentTimeRef.current = storeTime;
        scheduledNotesRef.current.clear(); // Clear scheduled notes on seek
        clearSatisfiedWaitNotes(); // Clear satisfied notes on seek
      }

      // Calculate new time using ref (not stale closure)
      const speed = state.playback.speed;
      const deltaSeconds = (deltaMs / 1000) * speed;
      const prevTime = currentTimeRef.current;
      const newTime = prevTime + deltaSeconds;
      currentTimeRef.current = newTime;

      // Check if we've reached the end
      if (newTime >= file.duration) {
        stop();
        return;
      }

      // Get notes that should be playing now (respects track.enabled)
      const activeNotes = getActiveNotesAtTime(file, newTime);
      const activeNoteNumbers = new Set(activeNotes.map((n) => n.noteNumber));

      // Wait mode: don't advance time until user plays the required notes
      // Use activeNotes (no grace period) for determining WHEN to wait
      // The grace period in getWaitModeNotes is only for accepting early hits
      if (state.playback.waitMode && activeNotes.length > 0) {
        // Get notes including grace period for checking satisfied status
        const waitModeNotes = getWaitModeNotes(file, newTime);
        const requiredNotes = waitModeNotes.map((n) => n.noteNumber);

        // Remove satisfied notes that are no longer required
        pruneStatisfiedWaitNotes(requiredNotes);

        // Check if all CURRENTLY ACTIVE notes have been played
        // (not upcoming notes within grace period)
        const satisfiedNotes = useMidiStore.getState().satisfiedWaitNotes;
        const allPlayed = [...activeNoteNumbers].every((note) =>
          satisfiedNotes.has(note),
        );

        if (!allPlayed) {
          // Don't advance time - keep currentTimeRef at prevTime
          currentTimeRef.current = prevTime;
          // Still update the animation frame to keep checking
          animationFrameRef.current = requestAnimationFrame(tick);
          return;
        }
        // All notes were played - continue advancing
      }

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
  }, [
    playback.isPlaying,
    getCurrentFile,
    pause,
    stop,
    seek,
    setActiveNotes,
    playNote,
    clearSatisfiedWaitNotes,
    pruneStatisfiedWaitNotes,
  ]);

  // Reset scheduled notes when stopping
  useEffect(() => {
    if (!playback.isPlaying) {
      scheduledNotesRef.current.clear();
    }
  }, [playback.isPlaying]);

  /** Toggle play/pause */
  const togglePlay = useCallback(async () => {
    console.log(
      '[Playback] togglePlay called, current isPlaying:',
      playback.isPlaying,
    );
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
    clearSatisfiedWaitNotes();
  }, [stop, stopAll, clearSatisfiedWaitNotes]);

  /** Seek to position (0-1) */
  const seekToPercent = useCallback(
    (percent: number) => {
      const file = getCurrentFile();
      if (!file) return;
      seek(file.duration * Math.max(0, Math.min(1, percent)));
    },
    [getCurrentFile, seek],
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
