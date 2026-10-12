import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { fmtBytes, kindBadge, splitStats, statusLine } from '../lib/transfer';
import { isTauri, playFile, revealFile, trashDownload } from '../lib/desktop';
import Confirm from './Confirm';
import { Icon, PATHS } from './icons';

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function TransferCard({ transferId, onRemove }: { transferId: string; onRemove: (id: string) => void }) {
  const item = useStore((s) => s.queue.find((q) => q.id === transferId));
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [actionError, setActionError] = useState('');
  const [, setTick] = useState(0);
  const alive = item?.status === 'working' && item.stage === 'processing';
  useEffect(() => {
    if (!alive) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [alive, transferId]);
  if (!item) return null;
  const done = item.status === 'done';
  const badge = kindBadge(item.kind, item.detail);
  // Totals can be estimates (mux): never render over 100%. Once every
  // expected byte arrived but the stream continues, say so honestly.
  // Percent-only sources (desktop sidecar classic lines): fall back to percent.
  const raw = item.total ? Math.round((item.loaded / item.total) * 100)
    : (item.percent ?? null);
  const pct = raw === null ? null : Math.min(100, Math.max(0, Math.round(raw)));
  // Unknown total and no percent: busy stripe, never a fake-full bar.
  const indeterminate = item.status === 'working' && pct === null;
  const elapsed = item.mergeAt ? fmtElapsed(Date.now() - item.mergeAt) : null;
  const baseText = statusLine(item, elapsed);
  const statusText = (pct !== null && item.total == null && item.status === 'working' && item.stage !== 'preparing')
    ? `${baseText} · ${pct}%`
    : baseText;
  // Structured stats row (icons): bytes + speed + ETA as nowrap chips so the
  // per-second numbers never re-wrap the line. The status line then carries
  // only the stage plus any remainder note (no duplicated numbers).
  const stats = splitStats(item.note);
  const bytesText = item.total != null
    ? `${fmtBytes(item.loaded)}/${fmtBytes(item.total)}`
    : item.loaded > 0 ? fmtBytes(item.loaded) : null;
  const showStats = item.status === 'working';
  const stageWord = item.stage === 'preparing' ? 'Preparing…'
    : item.stage === 'processing' ? `Processing…${elapsed ? ` · ${elapsed}` : ''}`
    : 'Downloading';
  const statusMeta = item.status === 'working'
    ? [stageWord, pct !== null && bytesText === null ? `${pct}%` : null, stats.rest].filter(Boolean).join(' · ')
    : statusText;
  async function play() {
    if (!item?.filepath) return;
    try {
      await playFile(item.filepath);
    } catch (e) {
      // Full error to the console for copy-paste; short text on the card.
      console.error('[KouTube] play failed', item.filepath, e);
      setActionError(e instanceof Error ? `Could not open the file: ${e.message}` : 'Could not open the file.');
    }
  }
  async function reveal() {
    if (!item?.filepath) return;
    try {
      await revealFile(item.filepath);
    } catch (e) {
      console.error('[KouTube] reveal failed', item.filepath, e);
      setActionError(e instanceof Error ? `Could not open the folder: ${e.message}` : 'Could not open the folder.');
    }
  }
  async function trash() {
    if (!item?.filepath) {
      onRemove(transferId);
      return;
    }
    try {
      await trashDownload(item.filepath);
      onRemove(transferId);
    } catch {
      setActionError('Could not move the file to trash.');
    }
  }
  return (
    <div className="job">
      <div className="row job-title-row">
        <strong className="job-title">{item.title}</strong>
      </div>
      <div className="row job-meta-row">
        {badge && <span className="chip tonal" aria-label={`Download type ${badge}`}>{badge}</span>}
        <span className="meta job-status">{statusMeta}</span>
        <button className="pill-btn text" style={{ minHeight: 32 }} aria-label={`Remove ${item.title}`} onClick={() => onRemove(transferId)}>
          ✕
        </button>
      </div>
      {showStats && (
        <div className="row job-stats">
          <span className="stat">
            <Icon d={PATHS.download} size={16} />
            <span>{bytesText ?? '–'}</span>
          </span>
          <span className="stat">
            <Icon d={PATHS.speed} size={16} />
            <span>{stats.speed ?? '–'}</span>
          </span>
          <span className="stat">
            <Icon d={PATHS.eta} size={16} />
            <span>{stats.eta ?? '–'}</span>
          </span>
        </div>
      )}
      <div
        className={`progress-pill${indeterminate ? ' indeterminate' : ''}`}
        role="progressbar"
        {...(pct === null ? {} : { 'aria-valuenow': pct })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Download progress ${item.title}`}
      >
        <div style={pct === null ? undefined : { width: `${pct}%` }} />
      </div>
      {item.error && <div className="field-error" role="alert">{item.error}</div>}
      {actionError && <div className="field-error" role="alert">{actionError}</div>}
      {done && item.filepath && isTauri() && (
        <div className="row" style={{ marginTop: 8 }}>
          <button className="pill-btn tonal icon-btn" onClick={play} aria-label={`Play ${item.title}`} title="Play"><Icon d={PATHS.play} /></button>
          <button className="pill-btn outlined icon-btn" onClick={reveal} aria-label={`Show ${item.title} in folder`} title="Show in folder"><Icon d={PATHS.folder} /></button>
          <button className="pill-btn outlined icon-btn" onClick={() => setConfirmTrash(true)} aria-label={`Delete ${item.title}`} title="Delete file">
            <Icon d={PATHS.trash} />
          </button>
        </div>
      )}
      {confirmTrash && (
        <Confirm
          title="Move file to trash?"
          body="The download stays in the list. This cannot be undone from here."
          items={item.filepath ? [item.filepath] : []}
          confirmLabel="Move to trash"
          onConfirm={() => { setConfirmTrash(false); void trash(); }}
          onCancel={() => setConfirmTrash(false)}
        />
      )}
      {item.rid && (
        <details className="meta">
          <summary>details</summary>
          <div>stage: {item.stage}{item.note ? ` · ${item.note}` : ''}</div>
          <div>request: {item.rid} (match with backend log)</div>
          {(item.log ?? []).length > 0 && (
            <pre style={{ whiteSpace: 'pre-wrap' }}>{(item.log ?? []).join('\n')}</pre>
          )}
        </details>
      )}
    </div>
  );
}
