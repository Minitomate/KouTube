import { useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { prepare, transferUrl, downloadToDisk, downloadZip } from '../lib/transfer';
import UrlBar from '../components/UrlBar';
import FormatPicker from '../components/FormatPicker';
import QualityPicker from '../components/QualityPicker';
import AudioPicker from '../components/AudioPicker';
import CaptionsPicker from '../components/CaptionsPicker';
import QueueView from '../components/QueueView';
import Stepper from '../components/Stepper';
import ThemeToggle from '../components/ThemeToggle';

const ZIP_CAP = 10;

export default function Home() {
  const { url, media, format, quality, audioTrack, captions, set, upsertTransfer } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  function fail(message: string) {
    setError(message);
    setBusy(false);
  }

  async function downloadSingle(pageUrl: string, title: string) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const rid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const stage = (st: 'fetching' | 'finalizing', note?: string) => {
      const cur = useStore.getState().queue.find((q) => q.id === id);
      if (cur && cur.status === 'working') upsertTransfer({ ...cur, stage: st, note });
    };
    try {
      upsertTransfer({ id, title, loaded: 0, total: null, status: 'working', stage: 'preparing', rid });
      const p = await prepare({ url: pageUrl, container: format, quality, audioTrack, captions });
      const ctl = new AbortController();
      abortRef.current = ctl;
      upsertTransfer({ id, title: p.filename, loaded: 0, total: p.sizeEstimate, status: 'working', stage: 'fetching', rid });
      await downloadToDisk(transferUrl(p), p.filename, p.sizeEstimate,
        (loaded, total) => upsertTransfer({ id, title: p.filename, loaded, total, status: 'working', stage: 'fetching', rid }),
        ctl.signal, { requestId: rid, onStage: stage });
      upsertTransfer({ id, title: p.filename, loaded: p.sizeEstimate ?? 0, total: p.sizeEstimate, status: 'done', stage: 'end', rid });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        upsertTransfer({ id, title, loaded: 0, total: null, status: 'cancelled', stage: 'end', rid });
      } else {
        const message = e instanceof Error ? e.message : 'Download failed';
        upsertTransfer({ id, title, loaded: 0, total: null, status: 'error', error: message, stage: 'end', rid });
        throw new Error(message);
      }
    }
  }

  async function download() {
    if (!url) { setError('Paste a YouTube URL first.'); return; }
    setError('');
    setBusy(true);
    try {
      if (media?.isPlaylist && media.entries?.length) {
        const items = media.entries.slice(0, ZIP_CAP);
        if (media.entries.length > ZIP_CAP) {
          setError(`ZIP capped at first ${ZIP_CAP} of ${media.entries.length} videos.`);
        }
        const zipItems: { filename: string; url: string; sizeEstimate: number | null }[] = [];
        for (const [i, e] of items.entries()) {
          const pageUrl = `https://www.youtube.com/watch?v=${e.videoId}`;
          const id = `zip-${i}`;
          upsertTransfer({ id, title: e.title || e.videoId, loaded: 0, total: null, status: 'working', stage: 'preparing' });
          try {
            const p = await prepare({ url: pageUrl, container: format, quality, audioTrack, captions });
            upsertTransfer({ id, title: p.filename, loaded: 0, total: p.sizeEstimate, status: 'working', stage: 'fetching' });
            zipItems.push({ filename: p.filename, url: transferUrl(p), sizeEstimate: p.sizeEstimate });
          } catch (e2) {
            upsertTransfer({
              id, title: e.title || e.videoId, loaded: 0, total: null,
              status: 'error', error: e2 instanceof Error ? e2.message : 'prepare failed', stage: 'end',
            });
          }
        }
        const ok = zipItems.filter((_, i) => useStore.getState().queue.some((q) => q.id === `zip-${i}` && q.status !== 'error'));
        if (!ok.length) return fail('No playlist items could be prepared.');
        await downloadZip(
          `${media.title || 'playlist'}.zip`, zipItems,
          (i, loaded, total) => {
            const it = zipItems[i];
            upsertTransfer({ id: `zip-${i}`, title: it.filename, loaded, total, status: 'working', stage: 'fetching' });
          },
          () => {},
          abortRef.current?.signal,
        );
        for (let i = 0; i < zipItems.length; i++) {
          const cur = useStore.getState().queue.find((q) => q.id === `zip-${i}`);
          if (cur?.status === 'working') {
            upsertTransfer({ ...cur, status: 'done' });
          }
        }
      } else {
        await downloadSingle(url, media?.title ?? url);
      }
      set({ step: 2 });
    } catch (e) {
      fail(e instanceof Error ? e.message : 'Could not start download. Is the backend running?');
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  return (
    <>
      <Stepper />
      <UrlBar />
      {media && !media.isPlaylist && (
        <div className="card">
          <h2>{media.title}</h2>
          <div className="meta">{Math.round(media.duration)}s</div>
        </div>
      )}
      {media?.isPlaylist && (
        <div className="card">
          <h2>{media.title}</h2>
          <div className="meta">playlist · {media.playlistCount} videos (ZIP, max {ZIP_CAP})</div>
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
          <button className="pill-btn filled" onClick={download} disabled={busy || !url} aria-label={media?.isPlaylist ? 'Download ZIP' : 'Download'}>
            {busy ? 'Working…' : media?.isPlaylist ? 'Download ZIP' : 'Download'}
          </button>
          {busy && (
            <button className="pill-btn outlined" onClick={cancel} aria-label="Cancel download">
              Cancel
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// Re-export ThemeToggle for App shell convenience
export { ThemeToggle };
// Re-export api for tests that import { api } from routes
export { api };
