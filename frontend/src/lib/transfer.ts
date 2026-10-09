// User-end transfer layer: backend only prepares + relays bytes, files land on user disk.
// Primary save path streams response.body straight to disk (no Blob buffering).
import { z } from 'zod';

export const PrepareSchema = z.object({
  filename: z.string(),
  container: z.string(),
  mergeRequired: z.boolean(),
  sizeEstimate: z.number().nullable(),
  streamToken: z.string(),
  muxToken: z.string().nullable(),
  captions: z.array(z.string()),
});
export type Prepare = z.infer<typeof PrepareSchema>;

export interface Choice {
  url: string;
  container: string;
  quality: string;
  audioTrack: string;
  captions: string[];
}

export async function prepare(c: Choice): Promise<Prepare> {
  const res = await fetch('/api/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: c.url,
      container: c.container === 'audio' ? 'mp3' : 'mp4',
      quality: c.container === 'audio' ? 'best' : c.quality,
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

export interface FetchOpts {
  /** Idle stall timeout before resume/abort. Defaults to 30s (tests pass ~200ms). */
  idleTimeoutMs?: number;
  /** Max resume attempts after stall/truncation. Defaults to 3. */
  maxResumes?: number;
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
  const anyWin = window as unknown as {
    showSaveFilePicker?: (o: unknown) => Promise<{
      createWritable: () => Promise<FileSystemWritableFileStream>;
    }>;
  };
  const automation = (navigator as unknown as { webdriver?: boolean }).webdriver === true;
  let writable: FileSystemWritableFileStream | null = null;
  if (anyWin.showSaveFilePicker && !automation) {
    try {
      const handle = await anyWin.showSaveFilePicker({ suggestedName: filename });
      writable = await handle.createWritable();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      writable = null; // headless/denied → anchor fallback below
    }
  }
  const chunks: Uint8Array[] = [];
  const write = async (c: Uint8Array) => {
    if (writable) {
      await writable.write(new Uint8Array(c.buffer, c.byteOffset, c.byteLength) as Uint8Array<ArrayBuffer>);
    } else chunks.push(c);
  };

  // Always request a byte range: defeats upstream throttling of full-file
  // requests and enables resume. honorsRange tracks server support.
  let loaded = 0;
  let total: number | null = sizeEstimate;
  let honorsRange = false;
  let resumes = 0;
  for (;;) {
    signal?.throwIfAborted();
    const res = await fetch(url, {
      signal,
      headers: { Range: `bytes=${loaded}-` },
    });
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
        await write(read.value);
        loaded += read.value.byteLength;
        onProgress(loaded, total);
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
