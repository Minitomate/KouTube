// API contract (backend: localhost:8000, proxied via /api).
// POST /api/resolve {url} -> backend ResolveResponse, normalized below to MediaInfo.
// POST /api/prepare (see lib/transfer.ts) -> Prepare (zod-validated).
import { z } from 'zod';

export interface AudioTrack { id: string; label: string; lang?: string }
export interface CaptionTrack { id: string; label: string; lang: string; manual: boolean }
export interface PlaylistEntry { videoId: string; title: string }
export interface MediaInfo {
  title: string; duration: number; thumbnail?: string;
  qualities: string[]; audioTracks: AudioTrack[]; captions: CaptionTrack[];
  isPlaylist?: boolean; playlistCount?: number; entries?: PlaylistEntry[];
}

export interface AudioTrack { id: string; label: string; lang?: string }
export interface CaptionTrack { id: string; label: string; lang: string; manual: boolean }
export interface MediaInfo {
  title: string; duration: number; thumbnail?: string;
  qualities: string[]; audioTracks: AudioTrack[]; captions: CaptionTrack[];
  isPlaylist?: boolean; playlistCount?: number;
}
const BackendResolve = z.object({
  videoId: z.string().nullable().optional(),
  title: z.string().default(''),
  thumbnail: z.string().nullable().optional(),
  duration: z.number().nullable().optional(),
  formats: z.array(z.object({ height: z.number().nullable().optional() }))
    .default([]),
  audioTracks: z.array(z.object({
    lang: z.string(), label: z.string(),
    is_default: z.boolean().optional(),
  })).default([]),
  manualCaptions: z.array(z.object({ lang: z.string(), label: z.string() }))
    .default([]),
  is_playlist: z.boolean().default(false),
  entries: z.array(z.object({
    videoId: z.string(), title: z.string().default(''),
  })).default([]),
});

function normalizeMedia(raw: unknown): MediaInfo {
  const b = BackendResolve.parse(raw);
  const heights = [...new Set(
    b.formats.map((f) => f.height).filter((h): h is number => !!h),
  )].sort((x, y) => x - y);
  return {
    title: b.title,
    duration: b.duration ?? 0,
    thumbnail: b.thumbnail ?? undefined,
    qualities: ['best', ...heights.map(String)],
    audioTracks: [
      { id: 'original', label: 'Original' },
      ...b.audioTracks
        .filter((t) => t.lang !== 'und')
        .map((t) => ({ id: t.lang, label: t.label, lang: t.lang })),
    ],
    captions: b.manualCaptions.map((c) => ({
      id: c.lang, label: c.label, lang: c.lang, manual: true,
    })),
    isPlaylist: b.is_playlist,
    playlistCount: b.entries.length || undefined,
    entries: b.entries.map((e) => ({ videoId: e.videoId, title: e.title })),
  };
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
    }).then((r) => json<unknown>(r)).then(normalizeMedia);
  },
};
