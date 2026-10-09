import { useState } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import UrlBar from '../components/UrlBar';
import FormatPicker from '../components/FormatPicker';
import QualityPicker from '../components/QualityPicker';
import AudioPicker from '../components/AudioPicker';
import CaptionsPicker from '../components/CaptionsPicker';
import QueueView from '../components/QueueView';
import Stepper from '../components/Stepper';
import ThemeToggle from '../components/ThemeToggle';

export default function Home() {
  const { url, media, format, quality, audioTrack, captions, set, upsertJob } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function download() {
    if (!url) { setError('Paste a YouTube URL first.'); return; }
    setError('');
    setBusy(true);
    try {
      const { job_id } = await api.startDownload({ url, format, quality, audioTrack, captions });
      upsertJob({ id: job_id, url, title: media?.title ?? url, progress: 0, status: 'queued' });
      set({ step: 2 });
    } catch {
      setError('Could not start download. Is the backend running?');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stepper />
      <UrlBar />
      {media && (
        <div className="card">
          <h2>{media.title}</h2>
          <div className="meta">{Math.round(media.duration)}s{media.isPlaylist ? ` · playlist ${media.playlistCount}` : ''}</div>
        </div>
      )}
      <FormatPicker />
      <QualityPicker />
      <AudioPicker />
      <CaptionsPicker />
      <QueueView />
      <div className="field-error" role="alert">{error}</div>
      <div className="sticky-cta">
        <div>
          <button className="pill-btn filled" onClick={download} disabled={busy || !url} aria-label="Download">
            {busy ? 'Starting…' : 'Download'}
          </button>
        </div>
      </div>
    </>
  );
}

// Re-export ThemeToggle for App shell convenience
export { ThemeToggle };
