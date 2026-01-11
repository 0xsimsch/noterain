import { useRef, useState } from 'react';
import {
  Play,
  Pause,
  Square,
  Volume2,
  VolumeX,
  Sun,
  Moon,
  ChevronUp,
  ChevronDown,
  Repeat,
  X,
  Eye,
  EyeOff,
} from 'lucide-react';
import { usePlayback } from '../../hooks/usePlayback';
import { useMidiFile } from '../../hooks/useMidiFile';
import { useMidiInput } from '../../hooks/useMidiInput';
import { useMidiStore, getMeasureCount, getSecondsPerMeasure } from '../../stores/midiStore';
import styles from './Controls.module.css';

export function Controls() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [tracksDropdownOpen, setTracksDropdownOpen] = useState(false);

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

{/* Export button hidden for now
            {currentFile && (
              <button className={styles.button} onClick={() => exportFile()}>
                Export
              </button>
            )}
*/}
          </div>
        </div>

        {/* Playback controls - centered */}
        <div className={styles.headerCenter}>
          <button
            className={`${styles.button} ${styles.playButton}`}
            onClick={togglePlay}
            disabled={!currentFile}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>

          <button
            className={`${styles.button} ${styles.playButton}`}
            onClick={stop}
            disabled={!currentFile}
          >
            <Square size={16} />
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
              className={`${styles.button} ${styles.iconButton} ${!settings.audioEnabled ? styles.mutedIcon : ''}`}
              onClick={() => updateSettings({ audioEnabled: !settings.audioEnabled })}
              title={settings.audioEnabled ? 'Mute audio' : 'Enable audio'}
            >
              {settings.audioEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
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
            {settings.theme === 'mocha' ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {/* Toggle expand button */}
          <button
            className={`${styles.button} ${styles.iconButton}`}
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? 'Hide controls' : 'Show controls'}
          >
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* Expanded grid content */}
      {isExpanded && (
        <div className={styles.grid}>
          {/* Render mode toggle */}
          <div className={styles.gridItem}>
            <button
              className={`${styles.button} ${styles.viewButton} ${!settings.showSheetMusic ? styles.active : ''}`}
              onClick={() => updateSettings({ showSheetMusic: false })}
            >
              Falling Notes
            </button>
            <button
              className={`${styles.button} ${styles.viewButton} ${settings.showSheetMusic ? styles.active : ''}`}
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
                <Repeat size={16} />
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
                    <X size={14} />
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

          {/* Track list - inline for 2 or fewer, dropdown for more */}
          {currentFile && currentFile.tracks.length > 0 && currentFile.tracks.length <= 2 && currentFile.tracks.map((track) => (
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
                {(track.renderOnly || track.enabled) ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              <button
                className={`${styles.trackButton} ${track.playAudio ? styles.active : styles.crossed}`}
                onClick={() =>
                  useMidiStore.getState().toggleTrackPlayAudio(currentFile.id, track.index)
                }
                title={track.playAudio ? 'Mute track' : 'Play track audio'}
              >
                {track.playAudio ? <Volume2 size={14} /> : <VolumeX size={14} />}
              </button>
            </div>
          ))}

          {/* Tracks dropdown for more than 2 tracks */}
          {currentFile && currentFile.tracks.length > 2 && (
            <div className={`${styles.gridItem} ${styles.tracksContainer}`}>
              <button
                className={`${styles.button} ${tracksDropdownOpen ? styles.active : ''}`}
                onClick={() => setTracksDropdownOpen(!tracksDropdownOpen)}
              >
                Tracks ({currentFile.tracks.length}) {tracksDropdownOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {tracksDropdownOpen && (
                <div className={styles.tracksDropdown}>
                  {currentFile.tracks.map((track) => (
                    <div
                      key={track.index}
                      className={styles.trackItem}
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
                        {(track.renderOnly || track.enabled) ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                      <button
                        className={`${styles.trackButton} ${track.playAudio ? styles.active : styles.crossed}`}
                        onClick={() =>
                          useMidiStore.getState().toggleTrackPlayAudio(currentFile.id, track.index)
                        }
                        title={track.playAudio ? 'Mute track' : 'Play track audio'}
                      >
                        {track.playAudio ? <Volume2 size={14} /> : <VolumeX size={14} />}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
