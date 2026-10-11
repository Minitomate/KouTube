import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { kindBadge, statusLine } from '../lib/transfer';
import { isTauri, playFile, revealFile, trashDownload } from '../lib/desktop';
import Confirm from './Confirm';

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
  const raw = item.total ? Math.round((item.loaded / item.total) * 100) : null;
  const pct = raw === null ? null : Math.min(100, raw);
  const elapsed = item.mergeAt ? fmtElapsed(Date.now() - item.mergeAt) : null;
  const statusText = statusLine(item, elapsed);
  async function play() {
    if (!item?.filepath) return;
    try {
      await playFile(item.filepath);
    } catch {
      setActionError('Could not open the file.');
    }
  }
  async function reveal() {
    if (!item?.filepath) return;
    try {
      await revealFile(item.filepath);
    } catch {
      setActionError('Could not open the folder.');
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
      <div className="row">
        {badge && <span className="chip tonal" aria-label={`Download type ${badge}`}>{badge}</span>}
        <strong style={{ flex: 1 }}>{item.title}</strong>
        <span className="meta">{statusText}</span>
        <button className="pill-btn text" style={{ minHeight: 32 }} aria-label={`Remove ${item.title}`} onClick={() => onRemove(transferId)}>
          ✕
        </button>
      </div>
      <div
        className="progress-pill"
        role="progressbar"
        {...(pct === null ? {} : { 'aria-valuenow': pct })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Download progress ${item.title}`}
      >
        <div style={{ width: `${pct ?? 100}%` }} />
      </div>
      {item.error && <div className="field-error" role="alert">{item.error}</div>}
      {actionError && <div className="field-error" role="alert">{actionError}</div>}
      {done && item.filepath && isTauri() && (
        <div className="row" style={{ marginTop: 8 }}>
          <button className="pill-btn tonal" style={{ minHeight: 40 }} onClick={play}>Play</button>
          <button className="pill-btn outlined" style={{ minHeight: 40 }} onClick={reveal}>Show in folder</button>
          <button className="pill-btn outlined" style={{ minHeight: 40 }} onClick={() => setConfirmTrash(true)}>
            Delete file
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
