import { create } from 'zustand';
import type { MediaInfo } from './api';

export type Format = 'video' | 'audio';
export type TransferStatus = 'working' | 'done' | 'error' | 'cancelled';
export type TransferStage = 'preparing' | 'fetching' | 'finalizing' | 'zipping' | 'end';
export interface Transfer {
  id: string; title: string; loaded: number; total: number | null;
  status: TransferStatus; error?: string;
  stage: TransferStage; note?: string; rid?: string;
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

interface State {
  step: 0 | 1 | 2;
  url: string;
  inspecting: boolean;
  media: MediaInfo | null;
  format: Format;
  quality: string;
  audioTrack: string;
  captions: string[];
  queue: Transfer[];
  theme: 'light' | 'dark';
  set: (p: Partial<State>) => void;
  toggleCaption: (id: string) => void;
  upsertTransfer: (t: Transfer) => void;
}

const QUALITIES = ['360', '720', '1080', '1440', '2160', '4320', 'best'];

export { QUALITIES };

export const useStore = create<State>((set) => ({
  step: 0,
  url: '',
  inspecting: false,
  media: null,
  format: 'video',
  quality: 'best',
  audioTrack: 'original',
  captions: [],
  queue: [],
  theme: 'light',
  set: (p) => set(p),
  toggleCaption: (id) =>
    set((s) => ({
      captions: s.captions.includes(id)
        ? s.captions.filter((c) => c !== id)
        : [...s.captions, id],
    })),
  upsertTransfer: (t) =>
    set((s) => ({
      queue: s.queue.some((q) => q.id === t.id)
        ? s.queue.map((q) => (q.id === t.id ? { ...q, ...t } : q))
        : [...s.queue.slice(-49), t], // cap batch at 50
    })),
}));
