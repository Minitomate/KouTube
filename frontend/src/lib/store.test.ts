import { describe, expect, it } from 'vitest';
import { useStore } from './store';

describe('playlist selection', () => {
  it('toggles videos and selects all (default scope is everything)', () => {
    const s = useStore.getState();
    s.selectAllVideos(['a', 'b', 'c']);
    expect(useStore.getState().selectedVideos).toEqual(['a', 'b', 'c']);
    useStore.getState().toggleSelectedVideo('b');
    expect(useStore.getState().selectedVideos).toEqual(['a', 'c']);
    useStore.getState().toggleSelectedVideo('b');
    expect(useStore.getState().selectedVideos).toEqual(['a', 'c', 'b']);
    useStore.getState().selectAllVideos([]);
    expect(useStore.getState().selectedVideos).toEqual([]);
    // Restore default so other suites see a clean store.
    useStore.getState().selectAllVideos([]);
  });
});
