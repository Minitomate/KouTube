import { useEffect, useRef, useState } from 'react';
import { useStore, blankTransfer, tlog, effectiveQuality, type Transfer } from '../lib/store';
import { api } from '../lib/api';
import { prepare, transferUrl, downloadToDisk, downloadZip, fmtRate, fmtETA } from '../lib/transfer';
import { isTauri, resolveOutDir, startDesktopDownload, ensureDesktopTools, getRecentLogs, mapDesktopEvent, pctRate } from '../lib/desktop';
import { loadSettings, saveSettings } from '../lib/settings';
import UrlBar from '../components/UrlBar';
import MediaSkeleton from '../components/MediaSkeleton';
import VideoInfoCard from '../components/VideoInfoCard';
import DownloadOptionsCard from '../components/DownloadOptionsCard';
import QueueView from '../components/QueueView';
import Stepper from '../components/Stepper';
import ThemeToggle from '../components/ThemeToggle';

const ZIP_CAP = 10;

export default function Home() {
  const { url, media, inspecting, format, quality, container, codec, audioTracks, captions, set, upsertTransfer, queue, online } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [warn, setWarn] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const desktopJobs = useRef(new Map<string, string>());
  const rateSamples = useRef(new Map<string, Array<{ t: number; p: number }>>());
  const batchCancelled = useRef(false);
  const [canCancel, setCanCancel] = useState(false);

  // Connectivity: navigator flag + lightweight probe; banner blocks starts.
  // Generation-tagged: a slow probe must never override a fresher event.
  const probeGen = useRef(0);
  useEffect(() => {
    let dead = false;
    const probe = async () => {
      const gen = ++probeGen.current;
      if (!navigator.onLine) {
        if (!dead) set({ online: false });
        return;
      }
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 8000);
        await fetch('https://www.youtube.com/generate_204', { mode: 'no-cors', signal: ctl.signal });
        clearTimeout(timer);
        if (!dead && gen === probeGen.current) set({ online: true });
      } catch {
        if (!dead && gen === probeGen.current) set({ online: false });
      }
    };
    const onUp = () => void probe();
    const onDown = () => { probeGen.current++; if (!dead) set({ online: false }); };
    window.addEventListener('online', onUp);
    window.addEventListener('offline', onDown);
    void probe();
    return () => {
      dead = true;
      window.removeEventListener('online', onUp);
      window.removeEventListener('offline', onDown);
    };
  }, [set]);

  // Desktop window: fit small screens, floor the minimum, center.
  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      try {
        const win = await import('@tauri-apps/api/window');
        const current = win.getCurrentWindow();
        const monitor = await win.primaryMonitor();
        const avail = monitor?.size;
        const scale = monitor?.scaleFactor || 1;
        const availW = avail ? avail.width / scale : 1280;
        const availH = avail ? avail.height / scale : 900;
        await current.setMinSize(new win.LogicalSize(480, 700));
        await current.setSize(new win.LogicalSize(
          Math.round(Math.min(1120, availW - 80)),
          Math.round(Math.min(900, availH - 120)),
        ));
        await current.center();
      } catch { /* best effort: default window stands */ }
    })();
  }, []);

  function fail(message: string) {
    setError(message);
    setBusy(false);
    setCanCancel(false);
  }

  /** Effective container/quality/notes from codec availability + rules. */
  function planDownload(): { quality: string; container: string; notes: string[] } {
    const notes: string[] = [];
    let cont: string = format === 'audio' ? 'mp3' : container;
    let q = quality;
    if (format === 'video' && media && !media.isPlaylist) {
      const eff = effectiveQuality(media.formatCodecs, quality, codec);
      if (eff.note) notes.push(eff.note);
      q = eff.quality;
      const dubs = audioTracks.filter((t) => t !== 'original');
      if (dubs.length > 1 && cont === 'mp4') {
        cont = 'mkv';
        notes.push('Merging to MKV: multiple audio tracks cannot go in MP4.');
      }
    }
    return { quality: q, container: cont, notes };
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
      const plan = planDownload();
      if (plan.notes.length) setWarn(plan.notes.join(' '));
      const p = await prepare({ url: pageUrl, container: format, outputContainer: plan.container, quality: plan.quality, codec, audioTrack: audioTracks[0] ?? 'original', captions });
      const ctl = new AbortController();
      abortRef.current = ctl;
      setCanCancel(true);
      upsertTransfer({ id, title: p.filename, loaded: 0, total: p.sizeEstimate, status: 'working', stage: 'fetching', rid });
      if (p.warnings.length) setWarn(p.warnings.join(' '));
      await downloadToDisk(transferUrl(p), p.filename, p.sizeEstimate,
        (loaded, total) => upsertTransfer({ id, title: p.filename, loaded, total, status: 'working', stage: 'fetching', rid }),
        ctl.signal, { requestId: rid, onStage: stage,
          directUrl: p.mergeRequired ? undefined : (p.videoUrl ?? undefined),
          noProbe: p.mergeRequired,
          onRate: (bps, eta) => {
            // Server notes win when fresh; client rate fills silence.
            const cur = useStore.getState().queue.find((q) => q.id === id);
            if (cur && cur.status === 'working' && !(cur.note ?? '').startsWith('server:')) {
              upsertTransfer({ ...cur, note: `${fmtRate(bps)}${eta != null ? ` · ${fmtETA(eta)} left` : ''}` });
            }
          },
          onServerProgress: (sLoaded, sTotal, note) => {
            const cur = useStore.getState().queue.find((q) => q.id === id);
            // Only drive the bar pre-first-byte; real bytes take over after.
            if (cur && cur.status === 'working' && cur.loaded === 0) {
              upsertTransfer({ ...cur, loaded: sLoaded, total: sTotal, note });
            }
          } });
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
    if (!online) { setError('You are offline. Reconnect to download.'); return; }
    setError('');
    setWarn('');
    if (isTauri()) {
      try {
        await downloadDesktop();
      } catch (e) {
        fail(e instanceof Error ? e.message : 'Download failed');
      }
      return;
    }
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
            const plan = planDownload();
            if (plan.notes.length) setWarn(plan.notes.join(' '));
            const p = await prepare({ url: pageUrl, container: format, outputContainer: plan.container, quality: plan.quality, codec, audioTrack: audioTracks[0] ?? 'original', captions });
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
      setCanCancel(false);
    }
  }

  async function copyDebugLog() {
    try {
      const lines: string[] = [];
      for (const q of queue) {
        lines.push(`## ${q.title} [${q.status}/${q.stage}]`);
        for (const l of q.log ?? []) lines.push(`  ${l}`);
        if (q.error) lines.push(`  error: ${q.error}`);
      }
      if (isTauri()) {
        try {
          const recent = await getRecentLogs();
          lines.push('## backend recent');
          for (const l of recent.slice(-40)) lines.push(`  ${l}`);
        } catch { /* frontend log alone still helps */ }
      }
      const text = lines.join('\n') || '(empty log)';
      await navigator.clipboard.writeText(text);
      setWarn('Debug log copied — paste it in your report.');
    } catch {
      setError('Could not copy the debug log.');
    }
  }

  function cancel() {
    abortRef.current?.abort();
    batchCancelled.current = true;
    const ids = [...desktopJobs.current.values()];
    desktopJobs.current.clear();
    setCanCancel(false);
    if (ids.length) {
      import('../lib/desktop').then((d) =>
        Promise.all(ids.map((jid) => d.cancelDesktopDownload(jid).catch(() => {}))),
      );
    }
  }

  async function downloadDesktopOne(
    pageUrl: string,
    title: string,
    outDir: string,
    transferId: string,
  ): Promise<void> {
    const put = (t: Parameters<typeof upsertTransfer>[0]) => upsertTransfer(tlog(t, t.stage));
    put({ ...blankTransfer(transferId, title), note: 'folder ok, starting' });
    const plan = planDownload();
    if (plan.notes.length) setWarn(plan.notes.join(' '));
    // Resolves only on terminal events so playlist items run sequentially.
    let stopFn = () => {};
    const resolveRef: { current: null | (() => void) } = { current: null };
    const done = new Promise<void>((resolve) => { resolveRef.current = resolve; });
    const finish = (t: Transfer, line: string) => {
      const cur = useStore.getState().queue.find((q) => q.id === transferId);
      upsertTransfer(tlog({ ...(cur ?? blankTransfer(transferId, title)), ...t }, line));
      desktopJobs.current.delete(transferId);
      if (!desktopJobs.current.size) setCanCancel(false);
      setBusy(false);
      stopFn(); resolveRef.current?.();
    };
    startDesktopDownload(
      {
        url: pageUrl, kind: format, outputContainer: plan.container,
        quality: plan.quality, codec, audioTracks, captions,
      },
      outDir,
      (e) => {
        const m = mapDesktopEvent(e);
        if (m.kind === 'done') {
          finish({ id: transferId, title: e.title ?? title, loaded: 100, total: 100, status: 'done', stage: 'end', note: e.note ?? undefined, filepath: e.filepath ?? undefined }, 'event: done');
        } else if (m.kind === 'error') {
          finish({ id: transferId, title, loaded: 0, total: null, status: 'error', error: e.error ?? 'failed', stage: 'end' }, `event: error ${e.error ?? ''}`);
        } else if (m.kind === 'cancelled') {
          finish({ id: transferId, title, loaded: 0, total: null, status: 'cancelled', stage: 'end' }, 'event: cancelled');
        } else {
          const cur = useStore.getState().queue.find((q) => q.id === transferId);
          const samples = rateSamples.current.get(transferId) ?? [];
          samples.push({ t: Date.now(), p: m.percent });
          rateSamples.current.set(transferId, samples.slice(-20));
          const rate = pctRate(samples, Date.now());
          const base = {
            id: transferId, title: e.title ?? title, loaded: m.percent, total: 100,
            status: 'working' as const, stage: m.stage,
            note: m.note ?? (rate !== null ? `~${rate.toFixed(1)}%/s` : undefined),
            mergeAt: m.stage === 'finalizing' ? (cur?.mergeAt ?? Date.now()) : cur?.mergeAt,
          };
          upsertTransfer(cur ? { ...cur, ...base } : { ...blankTransfer(transferId, title), ...base });
        }
      },
    ).then(({ jobId, stop }) => {
      stopFn = stop;
      desktopJobs.current.set(transferId, jobId);
      setCanCancel(true);
      const cur = useStore.getState().queue.find((q) => q.id === transferId);
      if (cur) upsertTransfer(tlog(cur, `invoke ok job=${jobId}, listener ok`));
    }).catch((err) => {
      finish({ id: transferId, title, loaded: 0, total: null, status: 'error', error: err instanceof Error ? err.message : 'failed', stage: 'end' }, `invoke/listener failed: ${err instanceof Error ? err.message : err}`);
    });
    await done;
  }

  async function downloadDesktop() {
    try {
      await ensureDesktopTools();
    } catch (e) {
      setError(e instanceof Error
        ? `Setup failed: ${e.message}. Check your connection and retry.`
        : 'Setup failed. Check your connection and retry.');
      return;
    }
    let outDir: string;
    try {
      const { settings } = await loadSettings();
      outDir = settings.outDir || await resolveOutDir();
      if (settings.splitKinds) {
        outDir = `${outDir.replace(/[/\\]$/, '')}/${format === 'audio' ? 'Audio' : 'Video'}`;
      }
      await saveSettings({ ...settings, outDir: settings.outDir || outDir });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No folder selected');
      return;
    }
    setBusy(true);
    batchCancelled.current = false;
    try {
      if (media?.isPlaylist && media.entries?.length) {
        // Desktop playlist: sequential singles into the chosen folder.
        batchCancelled.current = false;
        const items = media.entries.slice(0, ZIP_CAP);
        for (const [i, e] of items.entries()) {
          if (batchCancelled.current) break;
          const pageUrl = `https://www.youtube.com/watch?v=${e.videoId}`;
          try {
            await downloadDesktopOne(pageUrl, e.title || e.videoId, outDir, `desk-${Date.now()}-${i}`);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Item failed');
          }
        }
      } else {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await downloadDesktopOne(url, media?.title ?? url, outDir, id);
      }
      set({ step: 2 });
    } catch (e) {
      upsertTransfer({ id: 'desk-batch', title: url, loaded: 0, total: null, status: 'error', error: e instanceof Error ? e.message : 'failed', stage: 'end' });
      setBusy(false);
    }
  }

  return (
    <>
      <Stepper />
      <UrlBar />
      {!online && (
        <div className="card" role="alert">
          <strong>You're offline.</strong>
          <span className="meta"> Downloads and inspection need a connection — they'll work again when you're back.</span>
        </div>
      )}
      {media?.isPlaylist && (
        <div className="card">
          <h2>{media.title}</h2>
          <div className="meta">playlist · {media.playlistCount} videos {isTauri() ? `(files, max ${ZIP_CAP})` : `(ZIP, max ${ZIP_CAP})`}</div>
        </div>
      )}
      <div className="inspect-grid">
        <div>
          {inspecting && <MediaSkeleton />}
          {!inspecting && media && !media.isPlaylist && <VideoInfoCard media={media} />}
          {!inspecting && !media && (
            <div className="card"><p className="empty">Paste a link and press Inspect to see details.</p></div>
          )}
        </div>
        <DownloadOptionsCard />
      </div>
      <QueueView
        onRemove={(id) => set({ queue: useStore.getState().queue.filter((q) => q.id !== id) })}
        onClearFinished={() => set({
          queue: useStore.getState().queue.filter((q) => !['done', 'error', 'cancelled'].includes(q.status)),
        })}
        onCancelAll={() => {
          cancel();
          set({
            queue: useStore.getState().queue.filter((q) => !['done', 'error', 'cancelled'].includes(q.status)),
          });
        }}
      />
      {isTauri() && queue.length > 0 && (
        <button className="pill-btn tonal" onClick={copyDebugLog} aria-label="Copy debug log">
          Copy debug log
        </button>
      )}
      <div className="field-error" role="alert">{error}</div>
      {warn && <div className="meta" role="note">{warn}</div>}
      <div className="sticky-cta">
        <div>
          <button className="pill-btn filled" onClick={download} disabled={busy || !url} aria-label={media?.isPlaylist ? 'Download ZIP' : 'Download'}>
            {busy ? 'Working…' : media?.isPlaylist ? 'Download ZIP' : 'Download'}
          </button>
          {busy && canCancel && (
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
