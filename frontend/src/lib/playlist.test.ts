import { describe, expect, it } from 'vitest';
import { normalizeMedia } from './api';
import { nextVisibleCount, hqThumb, playlistCoverThumbnail, playlistThumb, playlistThumbLow, PLAYLIST_PAGE, selectedEntries } from './playlist';

describe('playlist preview', () => {
  it('keeps entry duration/thumbnail through normalize', () => {
    const m = normalizeMedia({
      title: 'AI Tools', is_playlist: true,
      channel: 'Alex Ziskind',
      entries: [
        { videoId: 'bYpdCFz7VtA', title: 'Faster agents', duration: 947, thumbnail: 'https://i.ytimg.com/vi/bYpdCFz7VtA/hqdefault.jpg' },
        { videoId: '9nKwDzsaAII', title: 'Supercomputers' },
      ],
    });
    expect(m.isPlaylist).toBe(true);
    expect(m.channel).toBe('Alex Ziskind');
    expect(m.entries?.[0]).toMatchObject({ videoId: 'bYpdCFz7VtA', duration: 947 });
    expect(m.entries?.[1].duration).toBeNull();
    expect(m.entries?.[1].thumbnail).toBeNull();
  });

  it('falls back to hqdefault when flat extract omits thumbnail', () => {
    expect(playlistThumb('abc123', null)).toBe('https://i.ytimg.com/vi/abc123/hqdefault.jpg');
    expect(playlistThumb('abc123', 'https://img/x.jpg')).toBe('https://img/x.jpg');
  });

  it('pages 10 at a time for scroll loading', () => {
    expect(PLAYLIST_PAGE).toBe(10);
    expect(nextVisibleCount(10, 42)).toBe(20);
    expect(nextVisibleCount(40, 42)).toBe(42);
  });

  it('resolves a cover from thumbnail or first entry', () => {
    expect(playlistCoverThumbnail('https://img/cover.jpg', [])).toBe('https://img/cover.jpg');
    expect(playlistCoverThumbnail(null, [{ videoId: 'bYpdCFz7VtA', thumbnail: null }]))
      .toBe('https://i.ytimg.com/vi/bYpdCFz7VtA/hqdefault.jpg');
    expect(playlistCoverThumbnail(null, [])).toBeUndefined();
  });

  it('upgrades covers to hq720 with hqdefault fallback source', () => {
    expect(hqThumb('https://i.ytimg.com/vi/abc/hqdefault.jpg'))
      .toBe('https://i.ytimg.com/vi/abc/hq720.jpg');
    expect(hqThumb('https://i.ytimg.com/vi/abc/hqdefault.jpg?sqp=-oaymwEXCOADEI4CSFryq4qpAwkIARUAAIhCGAE='))
      .toContain('hq720.jpg?sqp=');
    expect(hqThumb('https://i.ytimg.com/vi/abc/sddefault.jpg'))
      .toBe('https://i.ytimg.com/vi/abc/sddefault.jpg');
  });

  it('builds lightweight card thumbs', () => {
    expect(playlistThumbLow('bYpdCFz7VtA')).toBe('https://i.ytimg.com/vi/bYpdCFz7VtA/mqdefault.jpg');
  });

  it('filters entries by selection in playlist order', () => {    const entries = [
      { videoId: 'a', title: 'A' },
      { videoId: 'b', title: 'B' },
      { videoId: 'c', title: 'C' },
    ];
    expect(selectedEntries(entries, ['c', 'a']).map((e) => e.videoId)).toEqual(['a', 'c']);
    expect(selectedEntries(entries, [])).toEqual([]);
  });
});
