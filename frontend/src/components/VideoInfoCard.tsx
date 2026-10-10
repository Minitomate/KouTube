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

/** Left column: YouTube-recommendation-style video + channel info. */
export default function VideoInfoCard({ media }: { media: MediaInfo }) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const initial = (media.channel ?? media.title).trim().charAt(0).toUpperCase() || '▶';
  const meta = [media.views != null ? `${fmtCount(media.views)} views` : '', fmtDate(media.uploadDate)]
    .filter(Boolean).join(' • ');
  return (
    <div className="card">
      <div className="thumb-wrap">
        {media.thumbnail && <img src={media.thumbnail} alt="" loading="lazy" />}
        <span className="pill-badge">{fmtDuration(media.duration)}</span>
      </div>
      <h2>{media.title}</h2>
      {meta && <div className="meta">{meta}</div>}
      {media.channel && (
        <div className="channel-row">
          {media.avatarUrl && !avatarFailed ? (
            <img
              className="avatar" src={media.avatarUrl} alt=""
              loading="lazy" onError={() => setAvatarFailed(true)}
            />
          ) : (
            <span className="avatar avatar-fallback" aria-hidden="true">{initial}</span>
          )}
          <div className="channel-id">
            <strong>{media.channel}</strong>
            {media.channelVerified && <span aria-label="Verified channel"> ✓</span>}
            {media.subscribers != null && (
              <div className="meta">{fmtCount(media.subscribers)} subscribers</div>
            )}
          </div>
        </div>
      )}
      {media.description && (
        <div>
          <button
            className="pill-btn text" aria-expanded={descOpen}
            onClick={() => setDescOpen((v) => !v)}
          >
            {descOpen ? 'Hide description' : 'Show description'}
          </button>
          {descOpen && <p className="desc">{media.description.slice(0, 2000)}</p>}
        </div>
      )}
    </div>
  );
}
