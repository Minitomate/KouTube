// Playlist preview helpers: thumbnail fallback + progressive row count.
// Flat yt-dlp extracts often omit thumbnail/duration, so the UI falls back
// to hqdefault and hides the duration pill instead of breaking the row.
export const PLAYLIST_PAGE = 10;

export function playlistThumb(videoId: string, thumbnail?: string | null): string {
  if (thumbnail) return thumbnail;
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/** Playlist cover: resolved thumbnail, else first entry's thumb/hqdefault. */
export function playlistCoverThumbnail(
  thumbnail?: string | null,
  entries?: Array<{ videoId: string; thumbnail?: string | null }>,
): string | undefined {
  if (thumbnail) return thumbnail;
  const first = entries?.[0];
  if (!first) return undefined;
  return playlistThumb(first.videoId, first.thumbnail);
}

export function playlistThumbLow(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

/** Higher-res cover: hqdefault (480px) → hq720 (1280px, 16:9). */
export function hqThumb(url: string): string {
  return url.includes('hqdefault') ? url.replace('hqdefault', 'hq720') : url;
}

export function nextVisibleCount(current: number, total: number, step: number = PLAYLIST_PAGE): number {
  return Math.min(total, current + step);
}

/** Entries in playlist order, restricted to the user's selection. */
export function selectedEntries<T extends { videoId: string }>(entries: T[], selectedIds: string[]): T[] {
  const sel = new Set(selectedIds);
  return entries.filter((e) => sel.has(e.videoId));
}
