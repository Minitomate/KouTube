import { useEffect, useRef, useState } from 'react';
import pLimit from 'p-limit';
import { useStore, blankTransfer, tlog, effectiveQuality, resolveAudio, type Transfer, type AudioQuality } from '../lib/store';
import { api } from '../lib/api';
import { prepare, transferUrl, downloadToDisk, downloadZip, fmtRate, fmtETA, tagFilename, srtFilename, subsUrl, saveBlob } from '../lib/transfer';
import { isTauri, resolveOutDir, startDesktopDownload, ensureDesktopTools, mapDesktopEvent, byteRate, existingOutputs } from '../lib/desktop';
import { loadSettings, saveSettings, clampConcurrent } from '../lib/settings';
import Confirm from '../components/Confirm';
import UrlBar from '../components/UrlBar';
import MediaSkeleton from '../components/MediaSkeleton';
import VideoInfoCard from '../components/VideoInfoCard';
import DownloadOptionsCard from '../components/DownloadOptionsCard';
import QueueView from '../components/QueueView';
import Stepper from '../components/Stepper';
import ThemeToggle from '../components/ThemeToggle';

const ZIP_CAP = 10;

export default function Home() {
  const { url, media, inspecting, format, quality, container, codec, audioContainer, audioCodec, audioQuality, captionsFormat, audioTracks, captions, set, upsertTransfer, queue, online } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [warn, setWarn] = useState('');
  const abortRefs = useRef(new Set<AbortController>());
  const desktopJobs = useRef(new Map<string, string>());
  const rateSamples = useRef(new Map<string, Array<{ t: number; p: number }>>());
  const batchCancelled = useRef(false);
  const [canCancel, setCanCancel] = useState(false);
  const [overwriteAsk, setOverwriteAsk] = useState<{ files: string[]; outDir: string; splitKinds: boolean } | null>(null);

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

  /** Bounded pool: tasks run at most n at once, one failure never aborts the rest. */
  function pool(tasks: Array<() => Promise<unknown>>, n: number): Promise<PromiseSettledResult<unknown>[]> {
    const limit = pLimit(clampConcurrent(n));
    return Promise.allSettled(tasks.map((t) => limit(t)));
  }

  async function concurrency(): Promise<number> {
    try {
      const { settings } = await loadSettings();
      return clampConcurrent(settings.maxConcurrent);
    } catch {
      return 4;
    }
  }

  /** Effective container/quality/notes from codec availability + rules. */
  function planDownload(): {
    quality: string; container: string; notes: string[]; blocked?: string;
    audioCodec: string; audioQuality: AudioQuality | null;
  } {
    const notes: string[] = [];
    // Web relay can't transcode: new audio selects are desktop-only there.
    const desktop = isTauri();
    let cont: string = format === 'audio' ? (desktop ? audioContainer : 'mp3') : container;
    let q = quality;
    const au = resolveAudio(audioContainer, audioCodec, audioQuality);
    if (format === 'captions') {
      if (captions.length === 0) {
        return { quality: q, container: 'srt', notes, blocked: 'Select at least one caption language for captions mode.', audioCodec: au.codec, audioQuality: null };
      }
      return { quality: q, container: 'srt', notes, audioCodec: au.codec, audioQuality: null };
    }
    if (format === 'audio' && audioTracks.length === 0) {
      return { quality: q, container: cont, notes, blocked: 'Select at least one audio track for audio mode.', audioCodec: au.codec, audioQuality: null };
    }
    if (format === 'audio' && captions.length > 0) {
      notes.push('Captions are skipped for audio-only.');
    }
    if (format === 'video' && media && !media.isPlaylist) {
      const eff = effectiveQuality(media.formatCodecs, quality, codec);
      if (eff.note) notes.push(eff.note);
      q = eff.quality;
      if (media.audioTracks.length === 0) {
        notes.push('No audio tracks found — saving video-only.');
      } else if (audioTracks.length > 1 && cont === 'mp4') {
        cont = 'mkv';
        notes.push('Merging to MKV: multiple audio tracks cannot go in MP4.');
      }
    }
    return { quality: q, container: cont, notes, audioCodec: au.codec, audioQuality: desktop ? au.quality : null };
  }

  /** Badge detail for a transfer: language, quality, container. */
  function kindDetail(kind: 'video' | 'audio' | 'captions', lang?: string, quality?: string, container?: string): string | undefined {
    if (kind === 'audio') return lang;
    if (kind === 'captions') return lang;
    if (quality && container) return `${quality === 'best' ? 'best' : `${quality}p`} · ${container}`;
    return undefined;
  }

  async function downloadSingle(pageUrl: string, title: string, audioLang?: string, transferId?: string) {
    // Pre-created id when the caller enqueued upfront; else mint one here.
    const id = transferId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const rid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const lang = audioLang ?? audioTracks[0] ?? 'original';
    const kind = format as 'video' | 'audio';
    const stage = (st: 'downloading' | 'processing', note?: string) => {
      const cur = useStore.getState().queue.find((q) => q.id === id);
      if (cur && cur.status === 'working') upsertTransfer({ ...cur, stage: st, note });
    };
    const ctl = new AbortController();
    abortRefs.current.add(ctl);
    try {
      upsertTransfer({ id, title, loaded: 0, total: null, status: 'working', stage: 'preparing', rid, kind, detail: kindDetail(kind, lang) });
      const plan = planDownload();
      if (plan.notes.length) setWarn(plan.notes.join(' '));
      const p = await prepare({ url: pageUrl, container: format, outputContainer: plan.container, quality: plan.quality, codec, audioTrack: lang, captions: format === 'audio' ? [] : captions, subFormat: captionsFormat });
      // Multi-track audio: one file per language, tagged so names never collide.
      const filename = format === 'audio' && audioTracks.length > 1 ? tagFilename(p.filename, lang) : p.filename;
      const detail = kindDetail(kind, lang, plan.quality, plan.container);
      setCanCancel(true);
      upsertTransfer({ id, title: filename, loaded: 0, total: p.sizeEstimate, status: 'working', stage: 'downloading', rid, kind, detail });
      if (p.warnings.length) setWarn(p.warnings.join(' '));
      await downloadToDisk(transferUrl(p), filename, p.sizeEstimate,
        (loaded, total) => upsertTransfer({ id, title: filename, loaded, total, status: 'working', stage: 'downloading', rid, kind, detail }),
        ctl.signal, { requestId: rid, onStage: stage,
          directUrl: p.mergeRequired ? undefined : (p.videoUrl ?? undefined),
          noProbe: p.mergeRequired,
          willProcess: p.mergeRequired,
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
      upsertTransfer({ id, title: filename, loaded: p.sizeEstimate ?? 0, total: p.sizeEstimate, status: 'done', stage: 'end', rid });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        upsertTransfer({ id, title, loaded: 0, total: null, status: 'cancelled', stage: 'end', rid });
      } else {
        const message = e instanceof Error ? e.message : 'Download failed';
        upsertTransfer({ id, title, loaded: 0, total: null, status: 'error', error: message, stage: 'end', rid });
        throw new Error(message);
      }
    } finally {
      abortRefs.current.delete(ctl);
    }
  }

  async function download() {
    if (!url) { setError('Paste a YouTube URL first.'); return; }
    if (!online) { setError('You are offline. Reconnect to download.'); return; }
    const gate = planDownload();
    if (gate.blocked) { setError(gate.blocked); return; }
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
      const max = await concurrency();
      if (format === 'captions') {
        await downloadSubs();
      } else if (media?.isPlaylist && media.entries?.length) {
        const items = media.entries.slice(0, ZIP_CAP);
        if (media.entries.length > ZIP_CAP) {
          setError(`ZIP capped at first ${ZIP_CAP} of ${media.entries.length} videos.`);
        }
        // Multi-track audio: one prepared file per (video, language).
        const langs = format === 'audio' && audioTracks.length > 1
          ? audioTracks
          : [audioTracks[0] ?? 'original'];
        const combos = items.flatMap((e) => langs.map((lang) => ({ e, lang })));
        // Enqueue everything upfront so batch progress is visible at once.
        const comboKind = format as 'video' | 'audio';
        combos.forEach((c, k) => upsertTransfer({
          id: `zip-${k}`, title: c.e.title || c.e.videoId,
          loaded: 0, total: null, status: 'working', stage: 'preparing',
          kind: comboKind, detail: kindDetail(comboKind, c.lang),
        }));
        const zipItems: { id: string; filename: string; url: string; sizeEstimate: number | null }[] = [];
        const noCaps = format === 'audio' ? [] : captions;
        await pool(combos.map((c, k) => async () => {
          if (batchCancelled.current) return;
          const id = `zip-${k}`;
          const pageUrl = `https://www.youtube.com/watch?v=${c.e.videoId}`;
          try {
            const plan = planDownload();
            if (plan.notes.length) setWarn(plan.notes.join(' '));
            const p = await prepare({ url: pageUrl, container: format, outputContainer: plan.container, quality: plan.quality, codec, audioTrack: c.lang, captions: noCaps, subFormat: captionsFormat });
            const filename = langs.length > 1 ? tagFilename(p.filename, c.lang) : p.filename;
            const detail = kindDetail(comboKind, c.lang, plan.quality, plan.container);
            upsertTransfer({ id, title: filename, loaded: 0, total: p.sizeEstimate, status: 'working', stage: 'downloading', kind: comboKind, detail });
            zipItems.push({ id, filename, url: transferUrl(p), sizeEstimate: p.sizeEstimate });
          } catch (e2) {
            upsertTransfer({
              id, title: c.e.title || c.e.videoId, loaded: 0, total: null,
              status: 'error', error: e2 instanceof Error ? e2.message : 'prepare failed', stage: 'end',
            });
          }
        }), max);
        const ok = zipItems.filter((it) => useStore.getState().queue.some((q) => q.id === it.id && q.status !== 'error'));
        if (!ok.length) return fail('No playlist items could be prepared.');
        const zipCtl = new AbortController();
        abortRefs.current.add(zipCtl);
        try {
          await downloadZip(
            `${media.title || 'playlist'}.zip`, zipItems,
            (i, loaded, total) => {
              const it = zipItems[i];
              upsertTransfer({ id: it.id, title: it.filename, loaded, total, status: 'working', stage: 'downloading' });
            },
            () => {},
            zipCtl.signal,
          );
        } finally {
          abortRefs.current.delete(zipCtl);
        }
        for (const it of zipItems) {
          const cur = useStore.getState().queue.find((q) => q.id === it.id);
          if (cur?.status === 'working') {
            upsertTransfer({ ...cur, status: 'done' });
          }
        }
      } else if (format === 'audio' && audioTracks.length > 1) {
        const title = media?.title ?? url;
        const ids = audioTracks.map((_, k) => `trk-${Date.now()}-${k}`);
        ids.forEach((id, k) => upsertTransfer({
          id, title, loaded: 0, total: null,
          status: 'working', stage: 'preparing',
          kind: 'audio' as const, detail: audioTracks[k],
        }));
        await pool(audioTracks.map((lang, k) => async () => {
          if (batchCancelled.current) return;
          await downloadSingle(url, title, lang, ids[k]);
        }), max);
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

  /** Captions-only (web): one .srt per language, zipped when several. */
  async function downloadSubs() {
    const videos: { pageUrl: string; title: string; videoId?: string }[] =
      media?.isPlaylist && media.entries?.length
        ? media.entries.slice(0, ZIP_CAP).map((e) => ({
          pageUrl: `https://www.youtube.com/watch?v=${e.videoId}`,
          title: e.title || e.videoId, videoId: e.videoId,
        }))
        : [{ pageUrl: url, title: media?.title ?? url, videoId: media?.videoId }];
    if (media?.isPlaylist && (media.entries?.length ?? 0) > ZIP_CAP) {
      setError(`ZIP capped at first ${ZIP_CAP} of ${media.entries?.length} videos.`);
    }
    const zipItems = videos.flatMap((v, i) => captions.map((lang, j) => ({
      id: `zip-${i}-${j}`,
      filename: srtFilename(v.title, v.videoId, lang, captionsFormat),
      url: subsUrl(v.pageUrl, lang, captionsFormat),
      sizeEstimate: null as number | null,
    })));
    if (zipItems.length === 1) {
      const it = zipItems[0];
      const id = `${Date.now()}-sub`;
      const lang = captions[0];
      upsertTransfer({ id, title: it.filename, loaded: 0, total: null, status: 'working', stage: 'downloading', kind: 'captions', detail: lang });
      try {
        const res = await fetch(it.url);
        if (!res.ok) throw new Error(`Subtitles failed (HTTP ${res.status})`);
        saveBlob(await res.blob(), it.filename);
        upsertTransfer({ id, title: it.filename, loaded: 1, total: 1, status: 'done', stage: 'end', kind: 'captions', detail: lang });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Download failed';
        upsertTransfer({ id, title: it.filename, loaded: 0, total: null, status: 'error', error: message, stage: 'end', kind: 'captions', detail: lang });
        throw new Error(message);
      }
      return;
    }
    const zipCtl = new AbortController();
    abortRefs.current.add(zipCtl);
    setCanCancel(true);
    for (const it of zipItems) {
      upsertTransfer({ id: it.id, title: it.filename, loaded: 0, total: null, status: 'working', stage: 'preparing', kind: 'captions', detail: captions.join(', ') });
    }
    try {
      await downloadZip(
        `${media?.title || 'captions'}.zip`, zipItems,
        (i, loaded, total) => {
          const it = zipItems[i];
          upsertTransfer({ id: it.id, title: it.filename, loaded, total, status: 'working', stage: 'downloading' });
        },
        () => {},
        zipCtl.signal,
      );
    } finally {
      abortRefs.current.delete(zipCtl);
    }
    for (const it of zipItems) {
      const cur = useStore.getState().queue.find((q) => q.id === it.id);
      if (cur?.status === 'working') {
        upsertTransfer({ ...cur, status: 'done' });
      }
    }
  }

  function cancel() {
    abortRefs.current.forEach((c) => c.abort());
    abortRefs.current.clear();
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
    extra?: { videoId?: string; overwrite?: boolean; splitKinds?: boolean; audioTracks?: string[]; captionsOnly?: boolean },
  ): Promise<void> {
    const put = (t: Parameters<typeof upsertTransfer>[0]) => upsertTransfer(tlog(t, t.stage));
    put({ ...blankTransfer(transferId, title), note: 'folder ok, starting' });
    const plan = planDownload();
    if (plan.blocked) { setError(plan.blocked); return; }
    if (plan.notes.length) setWarn(plan.notes.join(' '));
    // Resolves only on terminal events so batched items can run pooled.
    let stopFn = () => {};
    const resolveRef: { current: null | (() => void) } = { current: null };
    const done = new Promise<void>((resolve) => { resolveRef.current = resolve; });
    const finish = (t: Transfer, line: string) => {
      const cur = useStore.getState().queue.find((q) => q.id === transferId);
      upsertTransfer(tlog({ ...(cur ?? blankTransfer(transferId, title)), ...t }, line));
      desktopJobs.current.delete(transferId);
      if (!desktopJobs.current.size) setCanCancel(false);
      // Pooled jobs: only the last one out clears the CTA.
      if (!useStore.getState().queue.some((q) => q.status === 'working')) setBusy(false);
      stopFn(); resolveRef.current?.();
    };
    startDesktopDownload(
      {
        url: pageUrl, videoId: extra?.videoId ?? media?.videoId,
        kind: extra?.captionsOnly ? 'captions' : format,
        outputContainer: plan.container,
        quality: plan.quality, codec,
        audioCodec: plan.audioCodec, audioQuality: plan.audioQuality,
        captionsFormat,
        audioTracks: extra?.audioTracks ?? audioTracks,
        // Audio-only never carries captions (they'd embed into every track).
        captions: format === 'audio' && !extra?.captionsOnly ? [] : captions,
        overwrite: extra?.overwrite ?? false, splitKinds: extra?.splitKinds ?? false,
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
          // Percent-scale samples would poison byte rates: track bytes only.
          if (m.loaded != null) {
            samples.push({ t: Date.now(), p: m.loaded });
            rateSamples.current.set(transferId, samples.slice(-20));
          }
          // Client rate only from real bytes; percent would mislabel the units.
          const rate = m.total != null ? byteRate(samples, Date.now()) : null;
          const base = {
            id: transferId, title: e.title ?? title,
            loaded: m.loaded ?? cur?.loaded ?? 0, total: m.total ?? cur?.total ?? null,
            status: 'working' as const, stage: m.stage,
            note: m.note ?? (rate !== null ? fmtRate(rate) : undefined),
            mergeAt: m.stage === 'processing' ? (cur?.mergeAt ?? Date.now()) : cur?.mergeAt,
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

  async function downloadDesktop(overwrite = false) {
    try {
      await ensureDesktopTools();
    } catch (e) {
      setError(e instanceof Error
        ? `Setup failed: ${e.message}. Check your connection and retry.`
        : 'Setup failed. Check your connection and retry.');
      return;
    }
    let outDir: string;
    let splitKinds = false;
    let maxConc = 4;
    try {
      const { settings } = await loadSettings();
      splitKinds = settings.splitKinds;
      maxConc = clampConcurrent(settings.maxConcurrent);
      outDir = settings.outDir || await resolveOutDir();
      if (settings.splitKinds) {
        const sub = format === 'audio' ? 'Audio' : format === 'captions' ? 'Captions' : 'Video';
        outDir = `${outDir.replace(/[/\\]$/, '')}/${sub}`;
      }
      await saveSettings({ ...settings, outDir: settings.outDir || outDir });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No folder selected');
      return;
    }
    // Overwrite pre-check: single videos only, skip when already confirmed.
    if (!overwrite && !media?.isPlaylist && media?.videoId && isTauri()) {
      try {
        const existing = await existingOutputs(outDir, media.videoId);
        if (existing.length) {
          setOverwriteAsk({ files: existing, outDir, splitKinds });
          return;
        }
      } catch { /* pre-check is best-effort; download proceeds */ }
    }
    setBusy(true);
    batchCancelled.current = false;
    try {
      const max = maxConc;
      const multiAudio = format === 'audio' && audioTracks.length > 1;
      type DeskTask = {
        pageUrl: string; title: string; id: string;
        kind: 'video' | 'audio' | 'captions'; detail?: string;
        extra: { videoId?: string; overwrite: boolean; splitKinds: boolean; audioTracks?: string[]; captionsOnly?: boolean };
      };
      const tasks: DeskTask[] = [];
      const stamp = Date.now();
      // Detail for the badge: language per audio track, quality/container for video.
      const plan = planDownload();
      const videoDetail = kindDetail('video', undefined, plan.quality, plan.container);
      const capDetail = captions.join(', ') || undefined;
      if (media?.isPlaylist && media.entries?.length) {
        const items = media.entries.slice(0, ZIP_CAP);
        items.forEach((e, i) => {
          const pageUrl = `https://www.youtube.com/watch?v=${e.videoId}`;
          const title = e.title || e.videoId;
          if (format === 'captions') {
            tasks.push({ pageUrl, title, id: `desk-${stamp}-${i}`, kind: 'captions', detail: capDetail, extra: { videoId: e.videoId, overwrite, splitKinds, captionsOnly: true } });
          } else if (multiAudio) {
            for (const lang of audioTracks) {
              tasks.push({ pageUrl, title, id: `desk-${stamp}-${i}-${lang}`, kind: 'audio', detail: lang, extra: { videoId: e.videoId, overwrite, splitKinds, audioTracks: [lang] } });
            }
          } else {
            tasks.push({ pageUrl, title, id: `desk-${stamp}-${i}`, kind: format as 'video' | 'audio', detail: format === 'audio' ? audioTracks[0] : videoDetail, extra: { videoId: e.videoId, overwrite, splitKinds } });
          }
        });
      } else if (format === 'captions') {
        tasks.push({ pageUrl: url, title: media?.title ?? url, id: `desk-${stamp}`, kind: 'captions', detail: capDetail, extra: { videoId: media?.videoId, overwrite, splitKinds, captionsOnly: true } });
      } else if (multiAudio) {
        for (const lang of audioTracks) {
          tasks.push({ pageUrl: url, title: media?.title ?? url, id: `desk-${stamp}-${lang}`, kind: 'audio', detail: lang, extra: { videoId: media?.videoId, overwrite, splitKinds, audioTracks: [lang] } });
        }
      } else {
        tasks.push({ pageUrl: url, title: media?.title ?? url, id: `desk-${stamp}`, kind: format as 'video' | 'audio', detail: format === 'audio' ? audioTracks[0] : videoDetail, extra: { videoId: media?.videoId, overwrite, splitKinds } });
      }
      // Enqueue everything upfront so batch progress is visible at once.
      for (const t of tasks) {
        upsertTransfer({ ...tlog(blankTransfer(t.id, t.title), 'queued'), kind: t.kind, detail: t.detail });
      }
      await pool(tasks.map((t) => async () => {
        if (batchCancelled.current) return;
        try {
          await downloadDesktopOne(t.pageUrl, t.title, outDir, t.id, t.extra);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Item failed');
        }
      }), max);
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
      <div className="field-error" role="alert">{error}</div>
      {warn && <div className="meta" role="note">{warn}</div>}
      {overwriteAsk && (
        <Confirm
          title="File already exists"
          body="This video was downloaded before. Download again and overwrite?"
          items={overwriteAsk.files}
          confirmLabel="Overwrite"
          onConfirm={() => { setOverwriteAsk(null); void downloadDesktop(true); }}
          onCancel={() => setOverwriteAsk(null)}
        />
      )}
      <div className="sticky-cta">
        <div>
          <button className="pill-btn filled cta-progress" onClick={download} disabled={busy || !url} aria-label={media?.isPlaylist ? 'Download ZIP' : 'Download'}>
            {(() => {
              const active = queue.find((q) => q.status === 'working');
              if (!busy || !active) return media?.isPlaylist ? 'Download ZIP' : 'Download';
              const raw = active.total ? Math.round((active.loaded / active.total) * 100) : null;
              const pct = raw === null ? null : Math.min(100, raw);
              const label = pct === null ? (active.note ?? 'Working…') : `${pct}%${active.note ? ` · ${active.note}` : ''}`;
              return (
                <>
                  {pct !== null && <span className="cta-fill" style={{ width: `${pct}%` }} aria-hidden="true" />}
                  <span className="cta-label">{label}</span>
                </>
              );
            })()}
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
