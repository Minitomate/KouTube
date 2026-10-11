import { create } from 'zustand';
import type { MediaInfo } from './api';
import type { DownloadDefaults } from './settings';

export type Format = 'video' | 'audio' | 'captions';
export type TransferStatus = 'working' | 'done' | 'error' | 'cancelled';
export type TransferStage = 'preparing' | 'downloading' | 'processing' | 'zipping' | 'end';
export type TransferKind = 'video' | 'audio' | 'captions';
export interface Transfer {
  id: string; title: string; loaded: number; total: number | null;
  status: TransferStatus; error?: string;
  stage: TransferStage; note?: string; rid?: string;
  filepath?: string;
  /** What is downloading (badge) + human detail (language, quality). */
  kind?: TransferKind; detail?: string;
  /** Epoch ms when stage last became processing (elapsed clock). */
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
export type AudioContainer = 'mp3' | 'm4a' | 'opus' | 'wav' | 'flac';
export type AudioQuality = 'best' | '320K' | '256K' | '192K' | '128K';
export type CaptionsFormat = 'srt' | 'vtt';

export const CODEC_LABELS: Record<Exclude<Codec, 'auto'>, string> = {
  avc: 'AVC (H.264)',
  hevc: 'HEVC (H.265)',
  vp9: 'VP9',
  av1: 'AV1',
};

export const AUDIO_CONTAINERS: AudioContainer[] = ['mp3', 'm4a', 'opus', 'wav', 'flac'];

/** Encoder choices per audio container (m4a alone offers two). */
export const AUDIO_CODECS: Record<AudioContainer, Array<{ id: string; label: string }>> = {
  mp3: [{ id: 'mp3', label: 'MP3' }],
  m4a: [{ id: 'aac', label: 'AAC' }, { id: 'alac', label: 'ALAC (lossless)' }],
  opus: [{ id: 'opus', label: 'Opus' }],
  wav: [{ id: 'wav', label: 'WAV (PCM)' }],
  flac: [{ id: 'flac', label: 'FLAC' }],
};

export const AUDIO_QUALITIES: Array<{ id: AudioQuality; label: string }> = [
  { id: 'best', label: 'Best' },
  { id: '320K', label: '320 kbps' },
  { id: '256K', label: '256 kbps' },
  { id: '192K', label: '192 kbps' },
  { id: '128K', label: '128 kbps' },
];

/** Resolved audio encode settings; quality is null for lossless or web relay. */
export function resolveAudio(
  container: AudioContainer,
  codec: string,
  quality: AudioQuality,
): { codec: string; quality: AudioQuality | null } {
  const ok = AUDIO_CODECS[container].some((c) => c.id === codec);
  const resolved = ok ? codec : AUDIO_CODECS[container][0].id;
  const lossless = container === 'wav' || container === 'flac' || resolved === 'alac';
  return { codec: resolved, quality: lossless ? null : quality };
}

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

/** Stamp download defaults onto the store (boot + Inspect); coerces stale combos. */
export function applyDownloadDefaults(d: DownloadDefaults) {
  const au = resolveAudio(d.audioContainer, d.audioCodec, d.audioQuality);
  return {
    format: d.format,
    quality: d.quality,
    container: d.container,
    codec: d.codec,
    audioContainer: d.audioContainer,
    audioCodec: au.codec,
    audioQuality: d.audioQuality,
    captionsFormat: d.captionsFormat,
  };
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
  audioContainer: AudioContainer;
  audioCodec: string;
  audioQuality: AudioQuality;
  captionsFormat: CaptionsFormat;
  audioTracks: string[];
  captions: string[];
  queue: Transfer[];
  theme: 'light' | 'dark' | 'auto';
  seed: string;
  variant: 'tonal-spot' | 'vibrant' | 'expressive';
  showAdvanced: boolean;
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
  audioContainer: 'mp3',
  audioCodec: 'mp3',
  audioQuality: 'best',
  captionsFormat: 'srt',
  audioTracks: [],
  captions: [],
  queue: [],
  theme: 'auto',
  seed: '#6750A4',
  variant: 'tonal-spot' as const,
  showAdvanced: false,
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
