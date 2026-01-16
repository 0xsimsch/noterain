import styles from './LoadingScreen.module.css';

type LoadingPhase = 'downloading' | 'decoding' | 'done';

interface LoadingScreenProps {
  phase: LoadingPhase;
  downloadProgress: number;
  decodeProgress: number;
  totalSamples: number;
  totalLayers: number;
}

export function LoadingScreen({
  phase,
  downloadProgress,
  decodeProgress,
  totalSamples,
  totalLayers,
}: LoadingScreenProps) {
  const isDownloading = phase === 'downloading';
  const progress = isDownloading ? downloadProgress : decodeProgress;
  const total = isDownloading ? totalSamples : totalLayers;
  const percentage = Math.round((progress / total) * 100);

  return (
    <div className={styles.overlay}>
      <div className={styles.container}>
        <div className={styles.title}>
          {isDownloading ? 'Downloading Piano Samples' : 'Decoding Piano Samples'}
        </div>
        <div className={styles.progressBar}>
          <div
            className={styles.progressFill}
            style={{ width: `${percentage}%` }}
          />
        </div>
        <div className={styles.progressText}>
          {isDownloading
            ? `${progress} / ${total} samples`
            : `${progress} / ${total} velocity layers`}
        </div>
      </div>
    </div>
  );
}
