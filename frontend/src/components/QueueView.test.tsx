import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useStore } from '../lib/store';
import type { MediaInfo } from '../lib/api';
import type { Transfer } from '../lib/store';
import QueueView from './QueueView';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => {};

function seed(media: MediaInfo | null, queue: Transfer[]) {
  act(() => {
    useStore.setState({ media, queue, selectedVideos: [], audioTracks: [], captions: [] });
  });
}

function render(): string {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(<QueueView onRemove={noop} onClearFinished={noop} onCancelAll={noop} />);
  });
  const html = el.innerHTML;
  act(() => {
    root.unmount();
  });
  el.remove();
  return html;
}

const playlistMedia = (n: number): MediaInfo => ({
  title: 'AI Tools',
  duration: 0,
  description: '',
  channel: 'Alex Ziskind',
  qualities: ['best'],
  formatCodecs: [],
  audioTracks: [],
  captions: [],
  isPlaylist: true,
  playlistCount: n,
  entries: Array.from({ length: n }, (_, i) => ({
    videoId: `v${i}`,
    title: `Video ${i}`,
    duration: null,
    thumbnail: null,
  })),
});

const working = (id: string, loaded: number, total: number | null): Transfer => ({
  id,
  title: `Video ${id}`,
  loaded,
  total,
  status: 'working',
  stage: 'downloading',
  kind: 'video',
});

describe('QueueView smoke', () => {
  it('renders with an empty queue (launch state)', () => {
    seed(null, []);
    expect(render()).toContain('queue-cards');
    seed(null, []);
  });

  it('renders populated playlist rows', () => {
    seed(playlistMedia(2), [working('t1', 50, 100), working('t2', 0, null)]);
    const html = render();
    expect(html).toContain('data-transfer-id="t1"');
    expect(html).toContain('data-transfer-id="t2"');
    seed(null, []);
  });
});
