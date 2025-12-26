import { useRef } from 'react';
import { usePlayback } from '../../hooks/usePlayback';
import { useMidiFile } from '../../hooks/useMidiFile';
import { useMidiInput } from '../../hooks/useMidiInput';
import { useMidiStore } from '../../stores/midiStore';
import styles from './Controls.module.css';

export function Controls() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    isPlaying,
    currentTime,
    speed,
    waitMode,
    togglePlay,
    stop,
    seekToPercent,
    setSpeed,
    toggleWaitMode,
    getProgress,
  } = usePlayback();

  const { files, currentFile, currentFileId, setCurrentFile, handleFileInput, exportFile } =
    useMidiFile();

  const { inputs, selectedInput, selectInput, isEnabled } = useMidiInput();

  const { settings, updateSettings } = useMidiStore();

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className={styles.controls}>
      {/* File controls */}
      <div className={styles.section}>
        <button
          className={styles.button}
          onClick={() => fileInputRef.current?.click()}
        >
          Open MIDI
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".mid,.midi"
          onChange={handleFileInput}
          style={{ display: 'none' }}
        />

        {files.length > 0 && (
          <select
            className={styles.select}
            value={currentFileId || ''}
            onChange={(e) => setCurrentFile(e.target.value || null)}
          >
            <option value="">Select file...</option>
            {files.map((file) => (
              <option key={file.id} value={file.id}>
                {file.name}
              </option>
            ))}
          </select>
        )}

        {currentFile && (
          <button className={styles.button} onClick={() => exportFile()}>
            Export
          </button>
        )}
      </div>

      {/* Playback controls */}
      <div className={styles.section}>
        <button
          className={`${styles.button} ${styles.playButton}`}
          onClick={togglePlay}
          disabled={!currentFile}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>

        <button
          className={styles.button}
          onClick={stop}
          disabled={!currentFile}
        >
          ⏹
        </button>

        <div className={styles.timeDisplay}>
          {formatTime(currentTime)} / {formatTime(currentFile?.duration || 0)}
        </div>

        <input
          type="range"
          className={styles.progressBar}
          min="0"
          max="100"
          value={getProgress() * 100}
          onChange={(e) => seekToPercent(parseFloat(e.target.value) / 100)}
          disabled={!currentFile}
        />
      </div>

      {/* Speed control */}
      <div className={styles.section}>
        <label className={styles.label}>
          Speed: {(speed * 100).toFixed(0)}%
        </label>
        <input
          type="range"
          className={styles.slider}
          min="10"
          max="200"
          value={speed * 100}
          onChange={(e) => setSpeed(parseFloat(e.target.value) / 100)}
        />
      </div>

      {/* Wait mode toggle */}
      <div className={styles.section}>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={waitMode}
            onChange={toggleWaitMode}
          />
          Wait for input
        </label>
      </div>

      {/* Audio toggle */}
      <div className={styles.section}>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={settings.audioEnabled}
            onChange={(e) => updateSettings({ audioEnabled: e.target.checked })}
          />
          Audio
        </label>

        {settings.audioEnabled && (
          <input
            type="range"
            className={styles.slider}
            min="0"
            max="100"
            value={settings.volume * 100}
            onChange={(e) =>
              updateSettings({ volume: parseFloat(e.target.value) / 100 })
            }
          />
        )}
      </div>

      {/* MIDI input selector */}
      <div className={styles.section}>
        <label className={styles.label}>MIDI Input:</label>
        {!isEnabled ? (
          <span className={styles.warning}>MIDI not available</span>
        ) : inputs.length === 0 ? (
          <span className={styles.muted}>No devices</span>
        ) : (
          <select
            className={styles.select}
            value={selectedInput?.id || ''}
            onChange={(e) => selectInput(e.target.value || null)}
          >
            <option value="">None</option>
            {inputs.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Track list */}
      {currentFile && currentFile.tracks.length > 0 && (
        <div className={styles.section}>
          <label className={styles.label}>Tracks:</label>
          <div className={styles.trackList}>
            {currentFile.tracks.map((track) => (
              <label
                key={track.index}
                className={styles.trackItem}
                style={{ borderLeftColor: track.color }}
              >
                <input
                  type="checkbox"
                  checked={track.enabled}
                  onChange={() =>
                    useMidiStore.getState().toggleTrack(currentFile.id, track.index)
                  }
                />
                {track.name}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
