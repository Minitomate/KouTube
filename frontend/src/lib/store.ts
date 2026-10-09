import { create } from 'zustand';
import type { MediaInfo } from './api';

export type Format = 'video' | 'audio';
export interface Job { id: string; url: string; title: string; progress: number; status: string }

interface State {
  step: 0 | 1 | 2;
  url: string;
  media: MediaInfo | null;
  format: Format;
  quality: string;
  audioTrack: string;
  captions: string[];
  queue: Job[];
  theme: 'light' | 'dark';
  set: (p: Partial<State>) => void;
  toggleCaption: (id: string) => void;
  upsertJob: (j: Job) => void;
}

const QUALITIES = ['360', '720', '1080', '1440', '2160', '4320', 'best'];

export { QUALITIES };

export const useStore = create<State>((set) => ({
  step: 0,
  url: '',
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
  upsertJob: (j) =>
    set((s) => ({
      queue: s.queue.some((q) => q.id === j.id)
        ? s.queue.map((q) => (q.id === j.id ? { ...q, ...j } : q))
        : [...s.queue.slice(-49), j], // cap playlist batch at 50
    })),
}));
