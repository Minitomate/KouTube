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

function progressPipe(total: number | null, onProgress: (loaded: number, total: number | null) => void) {
  let loaded = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      loaded += chunk.byteLength;
      controller.enqueue(chunk);
      onProgress(loaded, total);
    },
  });
}

export async function downloadToDisk(
  url: string,
  filename: string,
  sizeEstimate: number | null,
  onProgress: (loaded: number, total: number | null) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || sizeEstimate;
  const anyWin = window as unknown as {
    showSaveFilePicker?: (o: unknown) => Promise<{
      createWritable: () => Promise<FileSystemWritableFileStream>;
    }>;
  };
  const automation = (navigator as unknown as { webdriver?: boolean }).webdriver === true;
  if (anyWin.showSaveFilePicker && !automation) {
    try {
      const handle = await anyWin.showSaveFilePicker({ suggestedName: filename });
      const writable = await handle.createWritable();
      await res.body.pipeThrough(progressPipe(total, onProgress)).pipeTo(writable);
      return;
    } catch (e) {
      // User cancellation aborts; headless/denied environments fall through
      // to the anchor fallback below.
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
    }
  }
  // Fallback: buffer + anchor (Firefox/Safari, smaller files only).
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  const blob = new Blob(chunks as BlobPart[]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
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
      const res = await fetch(it.url, { signal });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length')) || it.sizeEstimate;
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
