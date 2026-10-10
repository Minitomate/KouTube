import { useState } from 'react';
import type { MediaInfo } from '../lib/api';

export function fmtCount(n?: number | null): string {
  if (n === undefined || n === null) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

export function fmtDuration(totalS: number): string {
  const s = Math.max(0, Math.round(totalS));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function fmtDate(yyyymmdd?: string): string {
  if (!yyyymmdd || yyyymmdd.length !== 8) return '';
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/** YouTube-style relative time ("2 hours ago"); falls back to the date. */
export function fmtRelative(timestampSec?: number, nowMs: number = Date.now()): string {
  if (!timestampSec) return '';
  const diff = Math.max(0, nowMs / 1000 - timestampSec);
  const minute = 60;
  const hour = 3600;
  const day = 86400;
  const month = 30 * day;
  const year = 365 * day;
  const qty = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (diff < hour) {
    const m = Math.max(1, Math.floor(diff / minute));
    return qty(m, 'minute');
  }
  if (diff < day) return qty(Math.floor(diff / hour), 'hour');
  if (diff < month) return qty(Math.floor(diff / day), 'day');
  if (diff < year) return qty(Math.floor(diff / month), 'month');
  return qty(Math.floor(diff / year), 'year');
}

/** Request a small avatar: normalize YouTube sizing to =s88. */
export function avatarThumb(url?: string): string | undefined {
  if (!url) return undefined;
  if (/=s\d+/.test(url)) return url.replace(/=s\d+(-c.*)?$/, '=s88');
  if (url.includes('googleusercontent')) return `${url}=s88`;
  return url;
}

const PLAY_TRIANGLE = 'M8 5v14l11-7z';
const VERIFIED_CHECK =
  'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z';

/** Left column: YouTube-recommendation-style video + channel info. */
export default function VideoInfoCard({ media }: { media: MediaInfo }) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [thumbLoaded, setThumbLoaded] = useState(false);
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const initial = (media.channel ?? media.title).trim().charAt(0).toUpperCase() || '▶';
  const rel = fmtRelative(media.timestamp) || (media.uploadDate ? fmtDate(media.uploadDate) : '');
  const exact = fmtDate(media.uploadDate);
  const meta = [media.views != null ? `${fmtCount(media.views)} views` : '', rel]
    .filter(Boolean).join(' • ');
  const avatar = !avatarFailed ? avatarThumb(media.avatarUrl) : undefined;
  return (
    <div className="card">
      <div className="thumb-wrap">
        {!thumbLoaded && <div className="sk sk-fill" aria-hidden="true" />}
        {media.thumbnail && (
          <img
            src={media.thumbnail} alt="" loading="lazy" fetchPriority="low"
            decoding="async" className={thumbLoaded ? 'img-ready' : 'img-waiting'}
            onLoad={() => setThumbLoaded(true)}
          />
        )}
        <span className="pill-badge">{fmtDuration(media.duration)}</span>
      </div>
      <h2>{media.title}</h2>
      {meta && (
        <div className="meta meta-row">
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="currentColor">
            <path d={PLAY_TRIANGLE} />
          </svg>
          <span>{meta}</span>
        </div>
      )}
      {media.channel && (
        <div className="channel-row">
          {avatar ? (
            <>
              {!avatarLoaded && <span className="sk sk-avatar" aria-hidden="true" />}
              <img
                className={`avatar${avatarLoaded ? '' : ' img-hidden'}`} src={avatar} alt=""
                loading="lazy" fetchPriority="low" decoding="async"
                onLoad={() => setAvatarLoaded(true)}
                onError={() => setAvatarFailed(true)}
              />
            </>
          ) : (
            <span className="avatar avatar-fallback" aria-hidden="true">{initial}</span>
          )}
          <div className="channel-id">
            <strong>
              {media.channel}
              {media.channelVerified && (
                <svg viewBox="0 0 24 24" width="14" height="14" aria-label="Verified channel" role="img" className="verified-mark">
                  <path d={VERIFIED_CHECK} fill="currentColor" />
                </svg>
              )}
            </strong>
            {media.subscribers != null && (
              <div className="meta">{fmtCount(media.subscribers)} subscribers</div>
            )}
          </div>
        </div>
      )}
      {media.description && (
        <div>
          <button
            className="pill-btn text desc-toggle" aria-expanded={descOpen}
            onClick={() => setDescOpen((v) => !v)}
          >
            {descOpen ? 'Show less' : '...more'}
          </button>
          {descOpen && (
            <div className="desc-box">
              <div className="desc-head">
                {[media.views != null ? `${fmtCount(media.views)} views` : '', rel, exact && exact !== rel ? exact : '']
                  .filter(Boolean).join(' • ')}
              </div>
              <p className="desc">{media.description.slice(0, 2000)}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
