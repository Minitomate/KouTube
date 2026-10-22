import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useStore } from '../lib/store';
import type { MediaInfo } from '../lib/api';
import MobileLinkDock from './MobileLinkDock';

// The M3 package's extensionless ESM imports break under vitest; this test
// only needs settings.ts to load, not its color math.
vi.mock('@material/material-color-utilities', () => ({
  argbFromHex: () => 0,
  Hct: { fromInt: () => ({}) },
  hexFromArgb: () => '#000000',
  Variant: { TONAL_SPOT: '', VIBRANT: '', EXPRESSIVE: '' },
  DynamicScheme: class {},
  MaterialDynamicColors: new Proxy({}, { get: () => ({ getArgb: () => 0 }) }),
}));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const url = 'https://youtu.be/a';
const media: MediaInfo = {
  videoId: 'a',
  title: 'Video A',
  duration: 60,
  description: '',
  qualities: ['best'],
  formatCodecs: [],
  audioTracks: [],
  captions: [],
};

function seed() {
  act(() => {
    useStore.setState({ url, media, queue: [], selectedVideos: [], audioTracks: [], captions: [] });
  });
}

function render(props: Partial<Parameters<typeof MobileLinkDock>[0]> = {}) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  const onDownload = vi.fn();
  act(() => {
    root.render(
      <MobileLinkDock
        error=""
        busy
        canCancel
        ctaBusy
        ctaPct={50}
        ctaLabel="0/1 · 50%"
        downloadLabel="Download"
        downloadDisabled={false}
        queued={false}
        onDownload={onDownload}
        onCancel={() => {}}
        {...props}
      />,
    );
  });
  return { el, root, onDownload };
}

function cleanup(el: HTMLElement, root: ReturnType<typeof createRoot>) {
  act(() => root.unmount());
  el.remove();
  seed();
}

describe('MobileLinkDock busy inspect', () => {
  it('keeps progress visible and expands/collapses the inspect field', () => {
    seed();
    const { el, root } = render();
    expect(el.querySelector('[role="progressbar"]')).not.toBeNull();
    const panel = el.querySelector('#dock-inspect-panel');
    expect(panel?.getAttribute('aria-hidden')).toBe('true');

    act(() => (el.querySelector('.dock-toggle') as HTMLButtonElement).click());
    expect(panel?.getAttribute('aria-hidden')).toBe('false');
    expect(el.querySelector('.dock-surface')?.classList.contains('dock-expanded')).toBe(true);
    expect(el.querySelector('[role="progressbar"]')).not.toBeNull();

    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(panel?.getAttribute('aria-hidden')).toBe('true');
    cleanup(el, root);
  });

  it('queues the inspected video instead of disabling Download', () => {
    seed();
    const { el, root, onDownload } = render();
    act(() => (el.querySelector('.dock-toggle') as HTMLButtonElement).click());
    const submit = el.querySelector('.dock-cta') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    expect(submit.textContent).toContain('Download');
    act(() => submit.click());
    expect(onDownload).toHaveBeenCalledTimes(1);
    cleanup(el, root);
  });

  it('disables Download once the URL is already queued', () => {
    seed();
    const { el, root, onDownload } = render({ queued: true });
    act(() => (el.querySelector('.dock-toggle') as HTMLButtonElement).click());
    const submit = el.querySelector('.dock-cta') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toContain('Queued');
    act(() => submit.click());
    expect(onDownload).not.toHaveBeenCalled();
    cleanup(el, root);
  });
});
