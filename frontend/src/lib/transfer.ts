// User-end transfer layer: backend only prepares + relays bytes, files land on user disk.
// Primary save path streams response.body straight to disk (no Blob buffering).
// Large files go direct-first over parallel ranged parts when possible.
import { z } from 'zod';
import pLimit from 'p-limit';

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
      subFormat: 'srt',
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

/** Insert ` [tag]` before the extension: `Title [id].mp3` → `Title [id] [en].mp3`. */
export function tagFilename(filename: string, tag: string): string {
  const i = filename.lastIndexOf('.');
  return i < 0 ? `${filename} [${tag}]` : `${filename.slice(0, i)} [${tag}]${filename.slice(i)}`;
}

/** Minimal client-side illegal-char strip (backend sanitizes authoritatively). */
export function safeName(s: string): string {
  return s.replace(/[<>:\"/\\|?*\x00-\x1f]/g, '_').trim().substring(0, 120) || 'video';
}

export function srtFilename(title: string, videoId: string | undefined, lang: string): string {
  return `${safeName(title)} [${videoId ?? 'video'}] [${lang}].srt`;
}

export function subsUrl(pageUrl: string, lang: string): string {
  return `/api/subs?url=${encodeURIComponent(pageUrl)}&lang=${encodeURIComponent(lang)}`;
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
  /** Stage transitions: 'fetching' on first byte, 'finalizing' past estimate. */
  onStage?: (stage: 'fetching' | 'finalizing', note?: string) => void;
  /** Server-side staging ticks (pre-first-byte): drive bar + note from them. */
  onServerProgress?: (loaded: number, total: number | null, note: string) => void;
  /** Client-computed throughput from actual arrivals (fallback when server is silent). */
  onRate?: (bytesPerSec: number, etaSec: number | null) => void;
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

export function fmtMB(n: number): string {
  return `${(n / 1048576).toFixed(n >= 104857600 ? 0 : 1)} MB`;
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

/** Rolling-3s throughput tracker feeding onRate (client fallback numbers). */
export function makeRateTracker(
  onRate: ((bytesPerSec: number, etaSec: number | null) => void) | undefined,
  getTotal: () => number | null,
) {
  const samples: Array<{ t: number; b: number }> = [];
  return (loaded: number) => {
    if (!onRate) return;
    const now = performance.now();
    samples.push({ t: now, b: loaded });
    while (samples.length > 2 && now - samples[0].t > 3000) samples.shift();
    if (samples.length < 2) return;
    const dt = (now - samples[0].t) / 1000;
    const db = loaded - samples[0].b;
    if (dt <= 0 || db <= 0) return;
    const bps = db / dt;
    const total = getTotal();
    onRate(bps, total !== null ? Math.max(0, (total - loaded) / bps) : null);
  };
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
        const what = p.phase.startsWith('staging-') ? p.phase.slice(8) : p.phase;
        const have = p.loaded ?? 0;
        const of = p.total ? ` / ${fmtMB(p.total)}` : '';
        const rate = p.rate ? ` · ${fmtRate(p.rate)}` : '';
        const eta = p.eta != null ? ` · ${fmtETA(p.eta)} left` : '';
        const note = p.phase === 'muxing'
          ? 'Merging on server…'
          : `Staging ${what} · ${fmtMB(have)}${of}${rate}${eta}`;
        onStage?.('fetching', `server: ${note}`);
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
    const track = makeRateTracker(opts?.onRate, () => total);
    const report = () => {
      const sum = per.reduce((a, b) => a + b, 0);
      onProgress(sum, total);
      track(sum);
      if (first) { first = false; onStage?.('fetching'); }
      if (sum >= total) onStage?.('finalizing', `${(sum / 1048576).toFixed(1)} MB received`);
    };
    const limit = pLimit(PART_CONCURRENCY);
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
    const sum = per.reduce((a, b) => a + b, 0);
    if (sum !== total) throw new Error(`Incomplete download (${sum}/${total} bytes)`);
    onProgress(sum, total);
  };

  const fetchSequential = async (base: string): Promise<void> => {
    const track = makeRateTracker(opts?.onRate, () => total);
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
          onProgress(loaded, total);
          track(loaded);
          if (firstByte) { firstByte = false; onStage?.('fetching'); }
          if (total !== null && loaded >= total) {
            onStage?.('finalizing', `${(loaded / 1048576).toFixed(1)} MB received`);
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
  };

  // Main: direct-first probe → parallel parts when possible → sequential.
  // Mux URLs skip probing (a probe would run the server merge twice).
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
  } finally {
    stopPoll();
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
        onItem(i, loaded, total);
      }
      try { await reader.cancel(); } catch { /* closed */ }
      reader.releaseLock();
      if (total !== null && loaded < total) {
        throw new Error(`incomplete (${loaded}/${total} bytes)`);
      }
      zip.file(it.filename, new Blob(chunks as BlobPart[]));
    } catch (e) {
      errors.push(`${it.filename}: ${e instanceof Error ? e.message : 'failed'}`);
      onItem(i, 0, it.sizeEstimate);
    }
  }
  if (errors.length) zip.file('_errors.txt', errors.join('\n'));
  const blob = await zip.generateAsync({ type: 'blob' }, (m) => onZip(m.percent));
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
