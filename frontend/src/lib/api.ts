// API contract (backend: localhost:8000, proxied via /api).
// POST /api/resolve {url} -> MediaInfo
// POST /api/download {url, format, quality, audioTrack, captions[]} -> {job_id}
// GET  /api/jobs/:id/events (SSE: {progress, status, file?})
// GET  /api/jobs/:id/files -> {files: {name, url}[]}
// DELETE /api/jobs/:id (cancel), POST /api/jobs/:id/retry

export interface AudioTrack { id: string; label: string; lang?: string }
export interface CaptionTrack { id: string; label: string; lang: string; manual: boolean }
export interface MediaInfo {
  title: string; duration: number; thumbnail?: string;
  qualities: string[]; audioTracks: AudioTrack[]; captions: CaptionTrack[];
  isPlaylist?: boolean; playlistCount?: number;
}
export interface DownloadPayload {
  url: string; format: 'video' | 'audio'; quality: string;
  audioTrack: string; captions: string[];
}
export interface JobEvent { progress: number; status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'; error?: string; file?: string }

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  resolve(url: string) {
    return fetch('/api/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }).then((r) => json<MediaInfo>(r));
  },
  startDownload(p: DownloadPayload) {
    return fetch('/api/download', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    }).then((r) => json<{ job_id: string }>(r));
  },
  files(jobId: string) {
    return fetch(`/api/jobs/${jobId}/files`).then((r) =>
      json<{ files: { name: string; url: string }[] }>(r),
    );
  },
  cancel(jobId: string) {
    return fetch(`/api/jobs/${jobId}`, { method: 'DELETE' }).then((r) => json<{ ok: boolean }>(r));
  },
  retry(jobId: string) {
    return fetch(`/api/jobs/${jobId}/retry`, { method: 'POST' }).then((r) =>
      json<{ job_id: string }>(r),
    );
  },
  sseUrl(jobId: string) {
    return `/api/jobs/${jobId}/events`;
  },
};

export function subscribeJob(jobId: string, onEvent: (e: JobEvent) => void): () => void {
  const es = new EventSource(api.sseUrl(jobId));
  es.onmessage = (m) => {
    try { onEvent(JSON.parse(m.data) as JobEvent); } catch { /* ignore */ }
  };
  return () => es.close();
}
