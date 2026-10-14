import { useEffect, useRef, useState } from 'react';
import type { MediaInfo } from '../lib/api';
import { PLAYLIST_PAGE, hqThumb, nextVisibleCount, playlistCoverThumbnail, playlistThumb } from '../lib/playlist';
import { isTauri } from '../lib/desktop';
import { useLocale, useStore } from '../lib/store';
import { fmtDuration } from './VideoInfoCard';

/** Left-column playlist preview: contracted header, expandable checklist. */
export default function PlaylistPreviewCard({ media }: { media: MediaInfo }) {
  const { t } = useLocale();
  const selectedVideos = useStore((s) => s.selectedVideos);
  const showThumbs = useStore((s) => s.showThumbnails);
  const toggleSelectedVideo = useStore((s) => s.toggleSelectedVideo);
  const selectAllVideos = useStore((s) => s.selectAllVideos);
  const entries = media.entries ?? [];
  const total = entries.length;
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(Math.min(PLAYLIST_PAGE, total));
  const sentinel = useRef<HTMLDivElement | null>(null);
  const cover = playlistCoverThumbnail(media.thumbnail, entries);
  const coverHq = cover ? hqThumb(cover) : undefined;
  const ids = entries.map((e) => e.videoId);

  useEffect(() => {
    setOpen(false);
    setVisible(Math.min(PLAYLIST_PAGE, total));
  }, [media.title, total]);

  useEffect(() => {
    if (!open) return;
    const el = sentinel.current;
    if (!el || visible >= total) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setVisible((v) => nextVisibleCount(v, total));
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [open, visible, total]);

  return (
    <div className="card">
      {showThumbs && coverHq && (
        <div className="pl-cover-stack">
          <div className="thumb-wrap">
            <img
              src={coverHq} alt="" loading="lazy" decoding="async"
              onError={(e) => {
                if (cover && e.currentTarget.src !== cover) e.currentTarget.src = cover;
              }}
            />
          </div>
        </div>
      )}
      <h2 className="video-title">{media.title}</h2>
      {media.channel && <div className="meta">{t('playlist.by', { channel: media.channel })}</div>}
      <div className="meta">{t('home.playlist', {
        n: total,
        mode: isTauri() ? t('home.modeFiles') : t('home.modeZip'),
      })}</div>
      <div className="meta">{t('playlist.selected', { n: selectedVideos.length, m: total })}</div>
      <div className="row" style={{ marginTop: 8 }}>
        <button
          type="button" className="select-pill md-button"
          aria-expanded={open} onClick={() => setOpen((v) => !v)}
        >
          {open ? t('playlist.collapse') : t('playlist.expand')}
        </button>
      </div>
      {open && (
        <>
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" className="pill-btn text" style={{ minHeight: 36 }} onClick={() => selectAllVideos(ids)}>
              {t('playlist.selectAll')}
            </button>
            <button type="button" className="pill-btn text" style={{ minHeight: 36 }} onClick={() => selectAllVideos([])}>
              {t('playlist.selectNone')}
            </button>
          </div>
          <div className="pl-list" role="listbox" aria-label={media.title} aria-multiselectable="true">
            {entries.slice(0, visible).map((e, i) => {
              const on = selectedVideos.includes(e.videoId);
              return (
                <div
                  className="md-option pl-row" role="option" aria-selected={on} tabIndex={0}
                  key={`${e.videoId}-${i}`}
                  onClick={() => toggleSelectedVideo(e.videoId)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      toggleSelectedVideo(e.videoId);
                    }
                  }}
                >
                  <input type="checkbox" tabIndex={-1} checked={on} readOnly aria-hidden="true" />
                  <span className="pl-index" aria-hidden="true">{i + 1}</span>
                  {showThumbs && (
                    <div className="pl-thumb-wrap">
                      <img src={playlistThumb(e.videoId, e.thumbnail)} alt="" loading="lazy" decoding="async" />
                      {e.duration != null && <span className="pill-badge">{fmtDuration(e.duration)}</span>}
                    </div>
                  )}
                  <div className="pl-meta">
                    <div className="pl-title" title={e.title}>{e.title || e.videoId}</div>
                    {media.channel && <div className="meta">{media.channel}</div>}
                  </div>
                </div>
              );
            })}
          </div>
          {visible < total && <div ref={sentinel} aria-hidden="true" />}
        </>
      )}
    </div>
  );
}
