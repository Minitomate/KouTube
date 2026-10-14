import { useEffect, useState } from 'react';
import { useStore, useLocale } from '../lib/store';
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
  const { lang, t } = useLocale();
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [actionError, setActionError] = useState('');
  const [, setTick] = useState(0);
  const showThumbs = useStore((s) => s.showThumbnails);
  const alive = item?.status === 'working' && item.stage === 'processing';
  useEffect(() => {
    if (!alive) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [alive, transferId]);
  if (!item) return null;
  const done = item.status === 'done';
  const badge = kindBadge(item.kind, item.detail, lang);
  // Totals can be estimates (mux): never render over 100%. Once every
  // expected byte arrived but the stream continues, say so honestly.
  // Percent-only sources (desktop sidecar classic lines): fall back to percent.
  const raw = item.total ? Math.round((item.loaded / item.total) * 100)
    : (item.percent ?? null);
  const pct = raw === null ? null : Math.min(100, Math.max(0, Math.round(raw)));
  // Unknown total and no percent: busy stripe, never a fake-full bar.
  const indeterminate = item.status === 'working' && pct === null;
  const elapsed = item.mergeAt ? fmtElapsed(Date.now() - item.mergeAt) : null;
  const baseText = statusLine(item, elapsed, lang);
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
  // Same key source as statusLine: one dictionary entry per stage word.
  const stageWord = item.stage === 'preparing' ? t('transfer.preparing')
    : item.stage === 'processing' ? `${t('transfer.processing')}${elapsed ? ` · ${elapsed}` : ''}`
    : t('transfer.downloading');
  const statusMeta = item.status === 'working'
    ? [stageWord, pct !== null && bytesText === null ? `${pct}%` : null, stats.rest].filter(Boolean).join(' · ')
    : statusText;
  async function play() {
    if (!item?.filepath) return;
    try {
      await playFile(item.filepath);
    } catch (e) {
      // Full error to the console for copy-paste; short text on the card.
      // Tauri rejects invokes with plain strings, not Errors — String(e)
      // keeps the real reason visible instead of a bare fallback.
      console.error('[KouTube] play failed', item.filepath, e);
      setActionError(t('transfer.openFileFailed', { msg: e instanceof Error ? e.message : String(e) }));
    }
  }
  async function reveal() {
    if (!item?.filepath) return;
    try {
      await revealFile(item.filepath);
    } catch (e) {
      console.error('[KouTube] reveal failed', item.filepath, e);
      setActionError(t('transfer.openFolderFailed', { msg: e instanceof Error ? e.message : String(e) }));
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
      setActionError(t('transfer.trashFailed'));
    }
  }
  const working = item.status === 'working';
  return (
    <div className="job" data-transfer-id={transferId}>
      {working && (
        <div
          className={`job-fill${indeterminate ? ' indeterminate' : ''}`}
          role="progressbar"
          {...(pct === null ? {} : { 'aria-valuenow': pct })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t('transfer.progress', { title: item.title })}
          style={pct === null || indeterminate ? undefined : { width: `${pct}%` }}
        />
      )}
      <div className="job-body">
      <div className="row job-title-row">
        {showThumbs && item.thumbnail && (
          <img className="job-thumb" src={item.thumbnail} alt="" loading="lazy" decoding="async" />
        )}
        <strong className="job-title">{item.title}</strong>
        <button className="pill-btn text" style={{ minHeight: 32, marginLeft: 'auto' }} aria-label={t('transfer.remove', { title: item.title })} onClick={() => onRemove(transferId)}>
          ✕
        </button>
      </div>
      <div className="row job-meta-row">
        {badge && <span className="chip tonal" aria-label={t('transfer.downloadType', { badge })}>{badge}</span>}
        <span className="meta job-status">{statusMeta}</span>
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
      {item.error && <div className="field-error" role="alert">{item.error}</div>}
      {actionError && <div className="field-error" role="alert">{actionError}</div>}
      {done && item.filepath && isTauri() && (
        <div className="row" style={{ marginTop: 8 }}>
          <button className="pill-btn tonal icon-btn" onClick={play} aria-label={t('transfer.playItem', { title: item.title })} title={t('transfer.play')}><Icon d={PATHS.play} /></button>
          <button className="pill-btn outlined icon-btn" onClick={reveal} aria-label={t('transfer.showItem', { title: item.title })} title={t('transfer.showFolder')}><Icon d={PATHS.folder} /></button>
          <button className="pill-btn outlined icon-btn" onClick={() => setConfirmTrash(true)} aria-label={t('transfer.deleteItem', { title: item.title })} title={t('transfer.deleteTitle')}>
            <Icon d={PATHS.trash} />
          </button>
        </div>
      )}
      {confirmTrash && (
        <Confirm
          title={t('transfer.trashTitle')}
          body={t('transfer.trashBody')}
          items={item.filepath ? [item.filepath] : []}
          confirmLabel={t('transfer.trashConfirm')}
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
    </div>
  );
}
