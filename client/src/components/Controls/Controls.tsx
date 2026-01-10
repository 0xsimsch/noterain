import { useRef, useState } from 'react';
import { usePlayback } from '../../hooks/usePlayback';
import { useMidiFile } from '../../hooks/useMidiFile';
import { useMidiInput } from '../../hooks/useMidiInput';
import { useMidiStore, getMeasureCount } from '../../stores/midiStore';
import styles from './Controls.module.css';

export function Controls() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isExpanded, setIsExpanded] = useState(true);

  const {
    isPlaying,
    currentTime,
    speed,
    waitMode,
    loopEnabled,
    loopStartMeasure,
    loopEndMeasure,
    togglePlay,
    stop,
    seekToPercent,
    setSpeed,
    toggleWaitMode,
    getProgress,
    setLoopRange,
    toggleLoop,
    clearLoop,
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
      {/* Header row - always visible */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
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
        </div>

        <div className={styles.headerRight}>
          {/* Theme toggle */}
          <button
            className={`${styles.button} ${styles.iconButton}`}
            onClick={() =>
              updateSettings({ theme: settings.theme === 'mocha' ? 'latte' : 'mocha' })
            }
            title={`Switch to ${settings.theme === 'mocha' ? 'light' : 'dark'} theme`}
          >
            {settings.theme === 'mocha' ? '☀️' : '🌙'}
          </button>

          {/* Toggle expand button */}
          <button
            className={`${styles.button} ${styles.iconButton}`}
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? 'Hide controls' : 'Show controls'}
          >
            {isExpanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* Expanded grid content */}
      {isExpanded && (
        <div className={styles.grid}>
          {/* Speed control */}
          <div className={styles.gridItem}>
            <label className={styles.label}>Speed:</label>
            <input
              type="number"
              className={styles.speedInput}
              min="10"
              max="200"
              step="5"
              value={Math.round(speed * 100)}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                if (!isNaN(val)) {
                  setSpeed(Math.max(10, Math.min(200, val)) / 100);
                }
              }}
            />
            <span className={styles.label}>%</span>
          </div>

          {/* Wait mode toggle */}
          <div className={styles.gridItem}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={waitMode}
                onChange={toggleWaitMode}
              />
              Wait for input
            </label>
          </div>

          {/* Loop controls */}
          {currentFile && (
            <div className={styles.gridItem}>
              <label className={styles.label}>Loop measures:</label>
              <button
                className={`${styles.button} ${loopEnabled ? styles.active : ''}`}
                onClick={toggleLoop}
                title="Toggle loop"
              >
                🔁
              </button>
              {loopEnabled && (
                <>
                  <input
                    type="number"
                    className={styles.measureInput}
                    min="1"
                    max={getMeasureCount(currentFile)}
                    value={(loopStartMeasure ?? 0) + 1}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) - 1;
                      if (!isNaN(val)) {
                        setLoopRange(Math.max(0, val), loopEndMeasure);
                      }
                    }}
                    title="Loop start measure"
                  />
                  <span className={styles.loopSeparator}>-</span>
                  <input
                    type="number"
                    className={styles.measureInput}
                    min="1"
                    max={getMeasureCount(currentFile)}
                    value={(loopEndMeasure ?? 0) + 1}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) - 1;
                      if (!isNaN(val)) {
                        const maxMeasure = getMeasureCount(currentFile) - 1;
                        setLoopRange(loopStartMeasure, Math.min(val, maxMeasure));
                      }
                    }}
                    title="Loop end measure"
                  />
                  <button
                    className={styles.button}
                    onClick={clearLoop}
                    title="Clear loop"
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          )}

          {/* Render mode toggle */}
          <div className={styles.gridItem}>
            <label className={styles.label}>View:</label>
            <button
              className={`${styles.button} ${!settings.showSheetMusic ? styles.active : ''}`}
              onClick={() => updateSettings({ showSheetMusic: false })}
            >
              Falling Notes
            </button>
            <button
              className={`${styles.button} ${settings.showSheetMusic ? styles.active : ''}`}
              onClick={() => updateSettings({ showSheetMusic: true })}
            >
              Sheet Music
            </button>
          </div>

          {/* Note color mode toggle (only for falling notes view) */}
          {!settings.showSheetMusic && (
            <div className={styles.gridItem}>
              <label className={styles.label}>Colors:</label>
              <button
                className={`${styles.button} ${settings.noteColorMode === 'track' ? styles.active : ''}`}
                onClick={() => updateSettings({ noteColorMode: 'track' })}
                title="Color notes by track"
              >
                Track
              </button>
              <button
                className={`${styles.button} ${settings.noteColorMode === 'pitch' ? styles.active : ''}`}
                onClick={() => updateSettings({ noteColorMode: 'pitch' })}
                title="Color notes by pitch (C, D, E, etc.)"
              >
                Pitch
              </button>
            </div>
          )}

          {/* Audio toggle */}
          <div className={styles.gridItem}>
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
          <div className={styles.gridItem}>
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
            <div className={`${styles.gridItem} ${styles.gridItemWide}`}>
              <label className={styles.label}>Tracks:</label>
              <div className={styles.trackList}>
                {currentFile.tracks.map((track) => (
                  <div
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
                    <span className={styles.trackName}>{track.name}</span>
                    <button
                      className={`${styles.trackButton} ${(track.renderOnly || track.enabled) ? styles.active : styles.crossed}`}
                      onClick={() =>
                        useMidiStore.getState().toggleTrackRenderOnly(currentFile.id, track.index)
                      }
                      title={track.renderOnly ? 'Hide track' : 'Show track visually'}
                      disabled={track.enabled}
                    >
                      👁
                    </button>
                    <button
                      className={`${styles.trackButton} ${track.playAudio ? styles.active : styles.crossed}`}
                      onClick={() =>
                        useMidiStore.getState().toggleTrackPlayAudio(currentFile.id, track.index)
                      }
                      title={track.playAudio ? 'Mute track' : 'Play track audio'}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M3 9v6h4l5 5V4L7 9H3z"/>
                        {track.playAudio && <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>}
                        {!track.playAudio && <path d="M19 12l-4-4m0 8l4-4" stroke="currentColor" strokeWidth="2" fill="none"/>}
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
