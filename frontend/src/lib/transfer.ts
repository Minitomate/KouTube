// User-end transfer layer: backend only prepares + relays bytes, files land on user disk.
// Primary save path streams response.body straight to disk (no Blob buffering).
// Large files go direct-first over parallel ranged parts when possible.
import { z } from 'zod';
import pLimit from 'p-limit';
import { t, type Locale } from './i18n';

export const PART_BYTES = 8 * 1024 * 1024;
export const PART_CONCURRENCY = 6;
export const PARALLEL_MIN_BYTES = 16 * 1024 * 1024;
/** First-byte budget for the direct-URL probe before proxy fallback. */
export const DIRECT_PROBE_MS = 8000;

/** Split total bytes into exact (start, end-inclusive) parts. */
export function planParts(total: number, size: number = PART_BYTES) {
  const parts: Array<{ start: number; end: number }> = [];
  let off = 0;
  while (off < total) {
    const end = Math.min(off + size - 1, total - 1);
    parts.push({ start: off, end });
    off = end + 1;
  }
  return parts;
}

// Hosts where direct fetch already failed this session: skip the probe.
const directFailedHosts = new Set<string>();

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

export const PrepareSchema = z.object({
  filename: z.string(),
  container: z.string(),
  mergeRequired: z.boolean(),
  sizeEstimate: z.number().nullable(),
  streamToken: z.string(),
  muxToken: z.string().nullable(),
  captions: z.array(z.string()),
  warnings: z.array(z.string()).default([]),
  videoUrl: z.string().nullable().optional(),
  audioUrl: z.string().nullable().optional(),
});
export type Prepare = z.infer<typeof PrepareSchema>;

export interface Choice {
  url: string;
  /** 'video' | 'audio' format kind. */
  container: string;
  /** Output container for video mode (mp4/webm/mkv). */
  outputContainer?: string;
  quality: string;
  codec?: string;
  audioTrack: string;
  captions: string[];
  subFormat: string;
}

export async function prepare(c: Choice): Promise<Prepare> {
  const res = await fetch('/api/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: c.url,
      container: c.container === 'audio' ? 'mp3' : (c.outputContainer ?? 'mp4'),
      quality: c.container === 'audio' ? 'best' : c.quality,
      codec: c.codec && c.codec !== 'auto' ? c.codec : null,
      audioTrackLang: c.audioTrack === 'original' ? null : c.audioTrack,
      embedCaptions: c.captions,
      subFormat: c.subFormat,
    }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    const d = (detail as { detail?: { code?: string; message?: string } }).detail;
    throw new Error(d?.message ?? `Prepare failed (HTTP ${res.status})`);
  }
  return PrepareSchema.parse(await res.json());
}

export function transferUrl(p: Prepare): string {
  return p.mergeRequired && p.muxToken
    ? `/api/mux?token=${encodeURIComponent(p.muxToken)}`
    : `/api/stream?token=${encodeURIComponent(p.streamToken)}`;
}

/** Badge text for a transfer: kind plus language/quality detail. */
export function kindBadge(kind: 'video' | 'audio' | 'captions' | undefined, detail?: string, locale: Locale = 'en'): string | null {
  if (!kind) return null;
  const label = kind === 'video' ? t(locale, 'kind.video') : kind === 'audio' ? t(locale, 'kind.audio') : t(locale, 'kind.captions');
  return detail ? `${label} · ${detail}` : label;
}

export interface StatusView {
  status: 'working' | 'done' | 'error' | 'cancelled';
  stage: string;
  loaded: number;
  total: number | null;
  note?: string;
  error?: string;
}

export interface BatchItem {
  status: string;
  loaded: number;
  total: number | null;
  percent?: number | null;
}

/** Per-item percent mirroring TransferCard: bytes first, percent fallback, done is 100. */
export function itemPercent(it: BatchItem): number | null {
  if (it.total) return Math.min(100, Math.max(0, Math.round((it.loaded / it.total) * 100)));
  if (it.status === 'done') return 100;
  return it.percent ?? null;
}

/** Queue-wide aggregate: done count, item count, mean of known per-item pcts. */
export function aggregateBatch(items: BatchItem[]): { done: number; total: number; pct: number | null } {
  const total = items.length;
  const done = items.filter((i) => i.status === 'done').length;
  const pcts = items.map(itemPercent).filter((p): p is number => p !== null);
  return { done, total, pct: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null };
}

/** Card status line: stage label + bytes (X/Y when known) + speed/ETA note. */
export function statusLine(view: StatusView, elapsed: string | null, locale: Locale = 'en'): string {
  if (view.status === 'done') return view.note ? `${t(locale, 'status.saved')} · ${view.note}` : t(locale, 'status.saved');
  if (view.status === 'error') return t(locale, 'status.failed', { msg: view.error ?? '' });
  if (view.status === 'cancelled') return t(locale, 'status.cancelled');
  if (view.stage === 'preparing') return t(locale, 'status.preparing');
  const bytes = view.total !== null
    ? `${fmtBytes(view.loaded)}/${fmtBytes(view.total)}`
    : view.loaded > 0 ? t(locale, 'status.downloaded', { n: fmtBytes(view.loaded) }) : null;
  const withNote = (base: string) => (view.note ? `${base} · ${view.note}` : base);
  const processing = view.stage === 'processing' || (view.total !== null && view.loaded >= view.total);
  if (processing) {
    return withNote(t(locale, 'status.processing', {
      x: fmtBytes(view.loaded), elapsed: elapsed ? ` · ${elapsed}` : '',
    }));
  }
  return withNote(`${t(locale, 'status.downloading')}${bytes ? ` · ${bytes}` : ''}`);
}

/** Split a transfer note into speed / ETA / remainder.
 * Matches only our own producers: client `${fmtRate} · ${fmtETA} left` and
 * server `Staging… · rate · eta left` notes. Anything else passes as rest. */
export function splitStats(note: string | undefined): { speed: string | null; eta: string | null; rest: string | null } {
  if (!note) return { speed: null, eta: null, rest: null };
  let speed: string | null = null;
  let eta: string | null = null;
  let text: string = note;
  const speedM = /([\d.]+ ?(?:[KMG]?i?B)\/s)/.exec(text);
  if (speedM) {
    speed = speedM[1];
    text = text.replace(speedM[0], '');
  }
  const etaM = /(\d+m \d+s|\d+s) left/.exec(text);
  if (etaM) {
    eta = `${etaM[1]} left`;
    text = text.replace(etaM[0], '');
  }
  if (!eta) {
    // Sidecar-native shape (`ETA 00:05`, `ETA 01:02:03`); `ETA Unknown`
    // has no timestamp and stays in the remainder by design.
    const sideM = /ETA (\d+:\d+(?::\d+)?)/.exec(text);
    if (sideM) {
      eta = `ETA ${sideM[1]}`;
      text = text.replace(sideM[0], '');
    }
  }
  let rest: string | null = text.split('·').map((s) => s.trim()).filter(Boolean).join(' · ') || null;
  if (rest) rest = rest.replace(/^server:\s*/, '') || null;
  return { speed, eta, rest };
}

/** Insert ` [tag]` before the extension: `Title [id].mp3` → `Title [id] [en].mp3`. */
export function tagFilename(filename: string, tag: string): string {
  const i = filename.lastIndexOf('.');
  return i < 0 ? `${filename} [${tag}]` : `${filename.slice(0, i)} [${tag}]${filename.slice(i)}`;
}

/** Minimal client-side illegal-char strip (backend sanitizes authoritatively). */
export function safeName(s: string): string {
  return s.replace(/[<>:\"/\\|?*\x00-\x1f]/g, '_').trim().substring(0, 120) || 'video';
}

export function srtFilename(title: string, videoId: string | undefined, lang: string, fmt = 'srt'): string {
  return `${safeName(title)} [${videoId ?? 'video'}] [${lang}].${fmt}`;
}

export function subsUrl(pageUrl: string, lang: string, fmt = 'srt', auto = false): string {
  return `/api/subs?url=${encodeURIComponent(pageUrl)}&lang=${encodeURIComponent(lang)}&fmt=${encodeURIComponent(fmt)}${auto ? '&auto=1' : ''}`;
}

/** Anchor download of an in-memory blob. */
export function saveBlob(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

export interface FetchOpts {
  /** Idle stall timeout before resume/abort. Defaults to 30s (tests pass ~200ms). */
  idleTimeoutMs?: number;
  /** Max resume attempts after stall/truncation. Defaults to 3. */
  maxResumes?: number;
  /** Correlates client progress with server logs (X-Request-ID). */
  requestId?: string;
  /** Stage transitions: 'downloading' on first byte, 'processing' past estimate. */
  onStage?: (stage: 'downloading' | 'processing', note?: string) => void;
  /** Server-side staging ticks (pre-first-byte): drive bar + note from them. */
  onServerProgress?: (loaded: number, total: number | null, note: string) => void;
  /** Client-computed throughput from actual arrivals (fallback when server is silent). */
  onRate?: (bytesPerSec: number, etaSec: number | null) => void;
  /** Post-fetch work (merge/extract) will run: allow the processing stage. */
  willProcess?: boolean;
  /** Direct upstream URL: probed first, proxy fallback on failure. */
  directUrl?: string;
  /** Skip the total probe (mux URLs: probing would run the merge twice). */
  noProbe?: boolean;
}

function toView(c: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(c.buffer, c.byteOffset, c.byteLength) as Uint8Array<ArrayBuffer>;
}

function anySignal(signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const live = signals.filter((s): s is AbortSignal => !!s);
  if (!live.length) return undefined;
  if (live.length === 1) return live[0];
  const AnyC = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  return typeof AnyC === 'function' ? AnyC.call(AbortSignal, live) : live[0];
}

class StallError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StallError(`stalled ${ms}ms without bytes`)), ms);
  });
  const onAbort = () => { if (timer !== undefined) clearTimeout(timer); };
  signal?.addEventListener('abort', onAbort, { once: true });
  return Promise.race([p, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  });
}

function totalFrom206(res: Response): number | null {
  const cr = res.headers.get('content-range'); // bytes 0-99/3449447
  const m = cr && /\/(\d+)\s*$/.exec(cr);
  return m ? Number(m[1]) : null;
}

export function fmtBytes(n: number): string {
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)} GB`;
  if (n >= 1048576) return `${(n / 1048576).toFixed(n >= 104857600 ? 0 : 1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

export function fmtRate(bps: number): string {
  return bps >= 1048576 ? `${(bps / 1048576).toFixed(1)} MB/s` : `${Math.max(1, Math.round(bps / 1024))} KB/s`;
}

export function fmtETA(s: number): string {
  if (!isFinite(s) || s < 0) return '';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

/** Clock-style ETA for sidecar-shaped chips: `1:05`, `1:01:05`. */
export function fmtClock(s: number): string {
  if (!isFinite(s) || s < 0) return '';
  const total = Math.round(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return `${h > 0 ? `${h}:` : ''}${h > 0 ? String(m).padStart(2, '0') : String(m)}:${String(sec).padStart(2, '0')}`;
}

/** Throttle to at most one call per `ms` (leading immediate, trailing replays
 * latest args). `flush()` emits pending now (completion paths stay exact). */
export function throttleLatest<T extends unknown[]>(
  fn: (...args: T) => void,
  ms: number,
): ((...args: T) => void) & { flush: () => void; cancel: () => void } {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: T | null = null;
  const fire = (...args: T) => { last = Date.now(); fn(...args); };
  const throttled = ((...args: T) => {
    const now = Date.now();
    if (now - last >= ms) {
      if (timer !== undefined) { clearTimeout(timer); timer = undefined; pending = null; }
      fire(...args);
      return;
    }
    pending = args;
    if (timer === undefined) {
      timer = setTimeout(() => {
        timer = undefined;
        if (pending) { const p = pending; pending = null; fire(...p); }
      }, ms - (now - last));
    }
  }) as ((...args: T) => void) & { flush: () => void; cancel: () => void };
  throttled.flush = () => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    if (pending) { const p = pending; pending = null; fire(...p); }
  };
  throttled.cancel = () => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    pending = null;
  };
  return throttled;
}

/** ETA hysteresis: hold the shown value through sub-band wobble and transient
 * unknowns so the chip counts down instead of blinking. The band is relative
 * (min 2.5s) so precision visibly tightens as the download converges. */
export function stableETA(prev: number | null, next: number | null): number | null {
  if (next === null) return prev;
  if (prev === null) return next;
  const band = Math.max(2.5, Math.abs(prev) * 0.1);
  return Math.abs(next - prev) < band ? prev : next;
}

/** Rolling-3s throughput tracker feeding onRate (client fallback numbers).
 *
 * Speed display uses the recent-window slope (responsive). ETA blends that
 * with the whole-download average, which stabilizes as evidence grows, so
 * precision improves over time instead of riding every throttle wave. */
export function makeRateTracker(
  onRate: ((bytesPerSec: number, etaSec: number | null) => void) | undefined,
  getTotal: () => number | null,
) {
  const samples: Array<{ t: number; b: number }> = [];
  let origin: { t: number; b: number } | null = null;
  let lastEta: number | null = null;
  const emit = (loaded: number, force = false) => {
    if (!onRate) return;
    const now = performance.now();
    if (!force) {
      samples.push({ t: now, b: loaded });
      origin ??= { t: now, b: loaded };
    }
    while (samples.length > 0 && now - samples[0].t > 3000) samples.shift();
    const total = getTotal();
    if (samples.length < 2) {
      // Stalled with something in flight: report 0 pace, hold last ETA.
      if (force && samples.length === 1 && now - samples[0].t > 1500 && loaded > 0) {
        onRate(0, stableETA(lastEta, null));
      }
      return;
    }
    // Hold until the window spans ~1s: early micro-bursts must never set a
    // flickering ETA; bytes still tick via onProgress meanwhile.
    const span = (now - samples[0].t) / 1000;
    if (span < 1.0) return;
    const db = loaded - samples[0].b;
    if (db <= 0) {
      lastEta = stableETA(lastEta, null);
      onRate(0, lastEta);
      return;
    }
    const recent = db / span;
    let pace = recent;
    if (origin && now - origin.t >= 2000) {
      const overall = (loaded - origin.b) / ((now - origin.t) / 1000);
      if (overall > 0) pace = 0.5 * recent + 0.5 * overall;
    }
    const eta = total !== null && pace > 0 ? Math.max(0, (total - loaded) / pace) : null;
    lastEta = stableETA(lastEta, eta);
    onRate(recent, lastEta);
  };
  return emit;
}

export async function downloadToDisk(
  url: string,
  filename: string,
  sizeEstimate: number | null,
  onProgress: (loaded: number, total: number | null) => void,
  signal?: AbortSignal,
  opts?: FetchOpts,
): Promise<void> {
  const idleMs = opts?.idleTimeoutMs ?? 30_000;
  const maxResumes = opts?.maxResumes ?? 3;
  const onStage = opts?.onStage;
  // Cap UI churn at 4Hz: per-chunk callbacks coalesce (leading immediate,
  // trailing latest). Completion paths cancel + report directly (exact).
  const progressTo = throttleLatest((ld: number, tt: number | null) => onProgress(ld, tt), 250);
  const rateCb = opts?.onRate;
  const rateTo = rateCb ? throttleLatest((bps: number, eta: number | null) => rateCb(bps, eta), 250) : undefined;
  const reqHeaders: Record<string, string> = {};
  if (opts?.requestId) reqHeaders['X-Request-ID'] = opts.requestId;
  const anyWin = window as unknown as {
    showSaveFilePicker?: (o: unknown) => Promise<{
      createWritable: () => Promise<FileSystemWritableFileStream>;
    }>;
  };
  const automation = (navigator as unknown as { webdriver?: boolean }).webdriver === true
    && !window.location.search.includes('forcefs=1');
  type Handle = { createWritable: () => Promise<FileSystemWritableFileStream> };
  let handle: Handle | null = null;
  let writable: FileSystemWritableFileStream | null = null;
  if (anyWin.showSaveFilePicker && !automation) {
    try {
      handle = await anyWin.showSaveFilePicker({ suggestedName: filename });
      writable = await handle.createWritable();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      handle = null; // headless/denied → anchor fallback below
    }
  }
  const chunks: Uint8Array[] = [];
  const write = async (c: Uint8Array) => {
    if (writable) {
      await writable.write(toView(c));
    } else chunks.push(c);
  };
  const positionedOk = async (): Promise<boolean> => {
    if (!writable) return false;
    try {
      await writable.write({ type: 'write', position: 0, data: new Uint8Array(0) });
      return true;
    } catch {
      return false;
    }
  };

  // Always request a byte range: defeats upstream throttling of full-file
  // requests and enables resume. honorsRange tracks server support.
  let loaded = 0;
  let total: number | null = sizeEstimate;
  let honorsRange = false;
  let resumes = 0;
  let firstByte = true;
  // While the server works before first byte (mux staging), poll its progress
  // so the UI shows liveness instead of a frozen bar. Stops at first chunk.
  let serverPoll: ReturnType<typeof setInterval> | undefined;
  const stopPoll = () => {
    if (serverPoll !== undefined) { clearInterval(serverPoll); serverPoll = undefined; }
  };
  if (opts?.requestId) {
    const rid = opts.requestId;
    const tick = async () => {
      try {
        const r = await fetch(`/api/mux-progress?rid=${encodeURIComponent(rid)}`);
        if (!r.ok) return;
        const p = (await r.json()) as {
          phase?: string; loaded?: number | null; total?: number | null;
          rate?: number | null; eta?: number | null;
        };
        if (!p || !p.phase || p.phase === 'ready' || p.phase === 'error' || p.phase === 'pending') return;
        const have = p.loaded ?? 0;
        const of = p.total ? ` / ${fmtBytes(p.total)}` : '';
        const rate = p.rate ? ` · ${fmtRate(p.rate)}` : '';
        const eta = p.eta != null ? ` · ${fmtETA(p.eta)} left` : '';
        let note: string;
        if (p.phase === 'muxing') {
          const bytes = have > 0 ? ` · ${fmtBytes(have)}${of}` : '';
          note = `Merging on server…${bytes}`;
        } else if (p.phase === 'subtitles') {
          note = `Fetching subtitles · ${fmtBytes(have)}${of}${rate}${eta}`;
        } else if (p.phase === 'starting') {
          note = 'Starting server merge…';
        } else {
          const what = p.phase.startsWith('staging-') ? p.phase.slice(8) : p.phase;
          note = `Staging ${what} · ${fmtBytes(have)}${of}${rate}${eta}`;
        }
        onStage?.('downloading', `server: ${note}`);
        opts.onServerProgress?.(have, p.total ?? null, note);
      } catch { /* poller is best-effort only */ }
    };
    void tick(); // leading edge: don't wait a full interval for the first note
    serverPoll = setInterval(tick, 1000);
  }
  // Direct-first: probe the upstream URL for first byte; CORS/network
  // failure (or a session-cached failure) falls back to the proxy URL.
  // Returns {base, direct} where direct tells whether parts may use it.
  const chooseBase = async (): Promise<{ base: string; direct: boolean }> => {
    const direct = opts?.directUrl;
    if (direct && !directFailedHosts.has(hostOf(direct))) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), DIRECT_PROBE_MS);
      try {
        const res = await fetch(direct, {
          signal: anySignal([signal, ctl.signal]),
          headers: { Range: 'bytes=0-' },
          cache: 'no-store',
        });
        if (res.status !== 200 && res.status !== 206) throw new Error(`HTTP ${res.status}`);
        if (!res.body) throw new Error('empty body');
        const reader = res.body.getReader();
        try {
          const first = await withTimeout(reader.read(), DIRECT_PROBE_MS, ctl.signal);
          if (first.done) throw new Error('empty body');
        } finally {
          try { await reader.cancel(); } catch { /* drained */ }
          reader.releaseLock();
        }
        try { await res.body.cancel(); } catch { /* drained */ }
        return { base: direct, direct: true };
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError' && signal?.aborted) throw e;
        directFailedHosts.add(hostOf(direct)); // remember for this session
      } finally {
        clearTimeout(timer);
      }
    }
    return { base: url, direct: false };
  };

  const probeTotal = async (base: string): Promise<{ total: number | null; ranges: boolean }> => {
    try {
      const res = await fetch(base, {
        signal, headers: { ...reqHeaders, Range: 'bytes=0-0' }, cache: 'no-store',
      });
      if (res.status === 206) {
        const total = totalFrom206(res);
        try { await res.body?.cancel(); } catch { /* drained */ }
        return { total, ranges: total !== null };
      }
      if (res.status === 200) {
        const total = Number(res.headers.get('content-length')) || null;
        try { await res.body?.cancel(); } catch { /* drained */ }
        return { total, ranges: false };
      }
    } catch { /* probe failure → sequential path decides */ }
    return { total: sizeEstimate, ranges: false };
  };

  const fetchPart = async (
    base: string, start: number, end: number, idx: number,
    writer: FileSystemWritableFileStream,
    onBytes: (n: number) => void,
  ): Promise<void> => {
    let off = start;
    for (let attempt = 0; attempt < 5 && off <= end; attempt++) {
      signal?.throwIfAborted();
      const res = await fetch(base, {
        signal, cache: 'no-store',
        headers: { ...reqHeaders, Range: `bytes=${off}-${end}` },
      });
      if (res.status === 416) {
        throw new Error(`Part ${idx} unsatisfiable (${off}-${end})`);
      }
      if (res.status !== 206 || !res.body) {
        throw new Error(`Part ${idx} HTTP ${res.status}`);
      }
      const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(res.headers.get('content-range') || '');
      if (!m || Number(m[1]) !== off || Number(m[2]) !== end) {
        throw new Error(`Part ${idx} range mismatch`);
      }
      const reader = res.body.getReader();
      try {
        for (;;) {
          let read: ReadableStreamReadResult<Uint8Array>;
          try {
            read = await withTimeout(reader.read(), idleMs, signal);
          } catch (e) {
            if (e instanceof StallError) break; // resume below
            throw e;
          }
          if (read.done) break;
          await writer.write({ type: 'write', position: off, data: toView(read.value) });
          off += read.value.byteLength;
          onBytes(read.value.byteLength);
        }
      } finally {
        try { await reader.cancel(); } catch { /* already closed */ }
        reader.releaseLock();
      }
    }
    if (off !== end + 1) {
      throw new Error(`Incomplete part ${idx} (${off - start}/${end - start + 1})`);
    }
  };

  const fetchParallel = async (base: string, total: number): Promise<void> => {
    if (!writable) throw new Error('parallel needs a file writer');
    const writer = writable;
    const parts = planParts(total);
    const per = new Array<number>(parts.length).fill(0);
    let first = true;
    const track = makeRateTracker(rateTo, () => total);
    const report = () => {
      const sum = per.reduce((a, b) => a + b, 0);
      progressTo(sum, total);
      track(sum);
      if (first) { first = false; onStage?.('downloading'); }
      // Processing only when post-fetch work (merge/extract) will actually run.
      if (sum >= total && opts?.willProcess) onStage?.('processing', `${fmtBytes(sum)} received`);
    };
    // 1s liveness: re-emit pace even with no new bytes (stall shows, bar stays alive).
    const alive = setInterval(() => {
      const sum = per.reduce((a, b) => a + b, 0);
      track(sum, true);
    }, 1000);
    const limit = pLimit(PART_CONCURRENCY);
    try {
    await Promise.all(parts.map((pt, i) => limit(async () => {
      const before = per[i];
      await fetchPart(base, pt.start, pt.end, i, writer, (n) => {
        per[i] += n;
        report();
      }).catch((e) => {
        per[i] = before; // don't count partial retries twice on failure paths
        throw e;
      });
    })));
    } finally {
      clearInterval(alive);
      progressTo.cancel();
      rateTo?.cancel();
    }
    const sum = per.reduce((a, b) => a + b, 0);
    if (sum !== total) throw new Error(`Incomplete download (${sum}/${total} bytes)`);
    progressTo.cancel();
    rateTo?.cancel();
    onProgress(sum, total);
  };

  const fetchSequential = async (base: string): Promise<void> => {
    const track = makeRateTracker(rateTo, () => total);
    // 1s liveness: re-emit pace even with no new bytes (stall shows 0, bar stays alive).
    const alive = setInterval(() => {
      progressTo(loaded, total);
      track(loaded, true);
    }, 1000);
    try {
    for (;;) {
      signal?.throwIfAborted();
      const fetchHeaders = { ...reqHeaders, Range: `bytes=${loaded}-` };
      const res = await fetch(base, { signal, headers: fetchHeaders });
      if (res.status !== 200 && res.status !== 206) {
        throw new Error(`Download failed (HTTP ${res.status})`);
      }
      if (!res.body) throw new Error('Download failed (empty body)');
      honorsRange = res.status === 206;
      if (honorsRange) total = totalFrom206(res) ?? total;
      else if (loaded === 0) total = Number(res.headers.get('content-length')) || total;
      else throw new Error('Server does not support resume; restart the download');
      const reader = res.body.getReader();
      try {
        for (;;) {
          let read: ReadableStreamReadResult<Uint8Array>;
          try {
            read = await withTimeout(reader.read(), idleMs, signal);
          } catch (e) {
            if (e instanceof StallError) break; // treat stall as stream end → resume/exhaust below
            throw e;
          }
          if (read.done) break;
          stopPoll();
          await write(read.value);
          loaded += read.value.byteLength;
          progressTo(loaded, total);
          track(loaded);
          if (firstByte) { firstByte = false; onStage?.('downloading'); }
          if (total !== null && loaded >= total && opts?.willProcess) {
            onStage?.('processing', `${fmtBytes(loaded)} received`);
          }
        }
      } finally {
        try { await reader.cancel(); } catch { /* already closed */ }
        reader.releaseLock();
      }
      if (total !== null && loaded < total) {
        if (honorsRange && resumes < maxResumes) { resumes += 1; continue; }
        throw new Error(`Incomplete download (${loaded}/${total} bytes)`);
      }
      break;
    }
    } finally {
      clearInterval(alive);
      progressTo.cancel();
      rateTo?.cancel();
    }
  };

  // Main: direct-first probe → parallel parts when possible → sequential.
  // Mux URLs skip probing (a probe would run the server merge twice).
  // A picked save-file holding a partial is discarded via abort() unless the
  // fetch stage completed; the blob fallback never persists anything.
  let completed = false;
  try {
    const { base } = await chooseBase();
    let known = sizeEstimate;
    let ranges = false;
    if (!opts?.noProbe) {
      const probed = await probeTotal(base);
      known = probed.total ?? sizeEstimate;
      ranges = probed.ranges;
    }
    total = known;
    if (ranges && known !== null && known >= PARALLEL_MIN_BYTES
        && writable && await positionedOk()) {
      await fetchParallel(base, known);
      loaded = known;
    } else {
      await fetchSequential(base);
    }
    completed = true;
  } finally {
    stopPoll();
    progressTo.cancel();
    rateTo?.cancel();
    if (!completed && writable) {
      try {
        await writable.abort();
      } catch { /* already closed or never written */ }
    }
  }
  if (writable) {
    await writable.close();
  } else {
    const blob = new Blob(chunks as BlobPart[]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  }
  onProgress(loaded, total);
}

export interface ZipItem {
  filename: string;
  url: string;
  sizeEstimate: number | null;
}

export async function downloadZip(
  zipName: string,
  items: ZipItem[],
  onItem: (index: number, loaded: number, total: number | null) => void,
  onZip: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const errors: string[] = [];
  // Item/progress callbacks fire per chunk: coalesce to 4Hz like downloads.
  const itemTo = throttleLatest(
    (i: number, loaded: number, total: number | null) => onItem(i, loaded, total), 250);
  const zipTo = throttleLatest((p: number) => onZip(p), 250);
  try {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    try {
      const res = await fetch(it.url, {
        signal,
        headers: { Range: 'bytes=0-' },
      });
      if (res.status !== 200 && res.status !== 206) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error('empty body');
      const total = res.status === 206
        ? totalFrom206(res) ?? it.sizeEstimate
        : Number(res.headers.get('content-length')) || it.sizeEstimate;
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        itemTo(i, loaded, total);
      }
      try { await reader.cancel(); } catch { /* closed */ }
      reader.releaseLock();
      if (total !== null && loaded < total) {
        throw new Error(`incomplete (${loaded}/${total} bytes)`);
      }
      itemTo.flush();
      onItem(i, loaded, total);
      zip.file(it.filename, new Blob(chunks as BlobPart[]));
    } catch (e) {
      errors.push(`${it.filename}: ${e instanceof Error ? e.message : 'failed'}`);
      itemTo.flush();
      onItem(i, 0, it.sizeEstimate);
    }
  }
  } finally {
    itemTo.flush();
    zipTo.flush();
  }
  if (errors.length) zip.file('_errors.txt', errors.join('\n'));
  const blob = await zip.generateAsync({ type: 'blob' }, (m) => zipTo(m.percent));
  zipTo.flush();
  const anyWin = window as unknown as {
    showSaveFilePicker?: (o: unknown) => Promise<{
      createWritable: () => Promise<FileSystemWritableFileStream>;
    }>;
  };
  const automation = (navigator as unknown as { webdriver?: boolean }).webdriver === true;
  if (anyWin.showSaveFilePicker && !automation) {
    try {
      const handle = await anyWin.showSaveFilePicker({ suggestedName: zipName });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = zipName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}
