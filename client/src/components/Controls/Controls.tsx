import { useRef, useState } from 'react';
import { usePlayback } from '../../hooks/usePlayback';
import { useMidiFile } from '../../hooks/useMidiFile';
import { useMidiInput } from '../../hooks/useMidiInput';
import { useMidiStore, getMeasureCount, getSecondsPerMeasure } from '../../stores/midiStore';
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

  const truncateFilename = (name: string, maxLength = 25): string => {
    if (name.length <= maxLength) return name;
    const ext = name.lastIndexOf('.') > 0 ? name.slice(name.lastIndexOf('.')) : '';
    const baseName = name.slice(0, name.length - ext.length);
    const truncatedLength = maxLength - ext.length - 3;
    return baseName.slice(0, truncatedLength) + '...' + ext;
  };

  return (
    <div className={styles.controls}>
      {/* Header row - always visible */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <img src="/logo.png" alt="NoteRain" className={styles.logo} />

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
                  <option key={file.id} value={file.id} title={file.name}>
                    {truncateFilename(file.name)}
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
        </div>

        {/* Playback controls - centered */}
        <div className={styles.headerCenter}>
          <button
            className={`${styles.button} ${styles.playButton}`}
            onClick={togglePlay}
            disabled={!currentFile}
          >
            {isPlaying ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <button
            className={`${styles.button} ${styles.playButton}`}
            onClick={stop}
            disabled={!currentFile}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" />
            </svg>
          </button>

          <div className={styles.timeDisplay}>
            {formatTime(currentTime)} / {formatTime(currentFile?.duration || 0)}
            {currentFile && (
              <span className={styles.measureDisplay}>
                M{Math.floor(currentTime / getSecondsPerMeasure(currentFile)) + 1}/{getMeasureCount(currentFile)}
              </span>
            )}
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

        <div className={styles.headerRight}>
          {/* Volume control */}
          <div className={styles.volumeControl}>
            <button
              className={`${styles.button} ${styles.iconButton}`}
              onClick={() => updateSettings({ audioEnabled: !settings.audioEnabled })}
              title={settings.audioEnabled ? 'Mute audio' : 'Enable audio'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9H3z"/>
                {settings.audioEnabled && (
                  <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                )}
                {!settings.audioEnabled && (
                  <path d="M16.5 12l4-4m0 8l-4-4" stroke="currentColor" strokeWidth="2" fill="none"/>
                )}
              </svg>
            </button>
            {settings.audioEnabled && (
              <input
                type="range"
                className={styles.volumeSlider}
                min="0"
                max="100"
                value={settings.volume * 100}
                onChange={(e) =>
                  updateSettings({ volume: parseFloat(e.target.value) / 100 })
                }
                title={`Volume: ${Math.round(settings.volume * 100)}%`}
              />
            )}
          </div>

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

          {/* Loop controls */}
          {currentFile && (
            <div className={styles.gridItem}>
              <label className={styles.label}>Loop:</label>
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
          {currentFile && currentFile.tracks.length > 0 && currentFile.tracks.map((track) => (
            <div
              key={track.index}
              className={styles.gridItem}
              style={{ borderLeftColor: track.color, borderLeftWidth: 3, borderLeftStyle: 'solid' }}
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
      )}
    </div>
  );
}
