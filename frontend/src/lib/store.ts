import { create } from 'zustand';
import type { MediaInfo } from './api';

export type Format = 'video' | 'audio' | 'captions';
export type TransferStatus = 'working' | 'done' | 'error' | 'cancelled';
export type TransferStage = 'preparing' | 'fetching' | 'finalizing' | 'zipping' | 'end';
export interface Transfer {
  id: string; title: string; loaded: number; total: number | null;
  status: TransferStatus; error?: string;
  stage: TransferStage; note?: string; rid?: string;
  filepath?: string;
  /** Epoch ms when stage last became finalizing (merge elapsed clock). */
  mergeAt?: number;
  /** Newest-last stage log (desktop flow); cap 30. Absent on older cards. */
  log?: string[];
}

export function blankTransfer(id: string, title: string): Transfer {
  return { id, title, loaded: 0, total: null, status: 'working', stage: 'preparing', log: [] };
}

export function tlog(t: Transfer, line: string): Transfer {
  const stamp = new Date().toISOString().slice(11, 19);
  return { ...t, log: [...(t.log ?? []).slice(-29), `${stamp} ${line}`] };
}

export type Container = 'mp4' | 'webm' | 'mkv';
export type Codec = 'auto' | 'avc' | 'hevc' | 'vp9' | 'av1';

export const CODEC_LABELS: Record<Exclude<Codec, 'auto'>, string> = {
  avc: 'AVC (H.264)',
  hevc: 'HEVC (H.265)',
  vp9: 'VP9',
  av1: 'AV1',
};

/** vcodec prefixes as they appear in format strings. */
const CODEC_PREFIXES: Record<Exclude<Codec, 'auto'>, string[]> = {
  avc: ['avc1', 'avc'],
  hevc: ['hev', 'hvc', 'hevc', 'h265'],
  vp9: ['vp09', 'vp9'],
  av1: ['av01', 'av1'],
};

export function vcodecMatches(vcodec: string | null | undefined, codec: Codec): boolean {
  if (codec === 'auto') return true;
  if (!vcodec || vcodec.toLowerCase() === 'none') return false;
  const v = vcodec.toLowerCase();
  return CODEC_PREFIXES[codec].some((p) => v.startsWith(p));
}

/** Best height ≤ wanted carrying the codec; null when codec is auto. */
export function effectiveQuality(
  formats: Array<{ height?: number | null; vcodec?: string | null }>,
  wanted: string,
  codec: Codec,
): { quality: string; note: string | null } {
  if (codec === 'auto' || wanted === 'best') return { quality: wanted, note: null };
  const want = Number(wanted);
  const heights = [...new Set(
    formats
      .filter((f) => f.height && vcodecMatches(f.vcodec, codec) && (!want || (f.height as number) <= want))
      .map((f) => f.height as number),
  )].sort((a, b) => a - b);
  if (!heights.length) return { quality: wanted, note: null };
  const best = String(heights[heights.length - 1]);
  return best === wanted
    ? { quality: wanted, note: null }
    : { quality: best, note: `${CODEC_LABELS[codec]} best available: ${best}p` };
}

interface State {
  step: 0 | 1 | 2;
  view: 'home' | 'settings';
  url: string;
  inspecting: boolean;
  online: boolean;
  media: MediaInfo | null;
  format: Format;
  quality: string;
  container: Container;
  codec: Codec;
  audioTracks: string[];
  captions: string[];
  queue: Transfer[];
  theme: 'light' | 'dark' | 'auto';
  seed: string;
  variant: 'tonal-spot' | 'vibrant' | 'expressive';
  set: (p: Partial<State>) => void;
  toggleCaption: (id: string) => void;
  toggleAudioTrack: (id: string) => void;
  upsertTransfer: (t: Transfer) => void;
}

export type Theme = 'light' | 'dark' | 'auto';

/** Effective theme: explicit choice, or OS preference in auto mode. */
export function resolveTheme(stored: Theme, systemDark: boolean): 'light' | 'dark' {
  if (stored === 'light') return 'light';
  if (stored === 'dark') return 'dark';
  return systemDark ? 'dark' : 'light';
}

const QUALITIES = ['360', '720', '1080', '1440', '2160', '4320', 'best'];

export { QUALITIES };

export const useStore = create<State>((set) => ({
  step: 0,
  view: 'home' as const,
  url: '',
  inspecting: false,
  media: null,
  format: 'video',
  quality: 'best',
  container: 'mp4',
  codec: 'auto',
  audioTracks: [],
  captions: [],
  queue: [],
  theme: 'auto',
  seed: '#6750A4',
  variant: 'tonal-spot' as const,
  online: true,
  set: (p) => set(p),
  toggleCaption: (id) =>
    set((s) => ({
      captions: s.captions.includes(id)
        ? s.captions.filter((c) => c !== id)
        : [...s.captions, id],
    })),
  toggleAudioTrack: (id) =>
    set((s) => ({
      audioTracks: s.audioTracks.includes(id)
        ? s.audioTracks.filter((c) => c !== id)
        : [...s.audioTracks, id],
    })),
  upsertTransfer: (t) =>
    set((s) => ({
      queue: s.queue.some((q) => q.id === t.id)
        ? s.queue.map((q) => (q.id === t.id ? { ...q, ...t } : q))
        : [...s.queue.slice(-49), t], // cap batch at 50
    })),
}));
