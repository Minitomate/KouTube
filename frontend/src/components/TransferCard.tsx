import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';

function mb(n: number) {
  return `${(n / 1048576).toFixed(1)} MB`;
}

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function TransferCard({ transferId }: { transferId: string }) {
  const item = useStore((s) => s.queue.find((q) => q.id === transferId));
  const [, setTick] = useState(0);
  const alive = item?.status === 'working' && item.stage === 'finalizing';
  useEffect(() => {
    if (!alive) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [alive, transferId]);
  if (!item) return null;
  // Totals can be estimates (mux): never render over 100%. Once every
  // expected byte arrived but the stream continues, say so honestly.
  const raw = item.total ? Math.round((item.loaded / item.total) * 100) : null;
  const pct = raw === null ? null : Math.min(100, raw);
  const finalizing = item.status === 'working' &&
    (item.stage === 'finalizing' || (item.total !== null && item.loaded >= item.total));
  const elapsed = item.mergeAt ? fmtElapsed(Date.now() - item.mergeAt) : null;
  const statusText =
    item.status === 'done' ? (item.note ? `saved ✓ · ${item.note}` : 'saved ✓')
    : item.status === 'error' ? `failed: ${item.error ?? ''}`
    : item.status === 'cancelled' ? 'cancelled'
    : item.stage === 'preparing' ? 'preparing…'
    : finalizing ? `Finalizing… ${mb(item.loaded)} received${elapsed ? ` · ${elapsed}` : ''}`
    : item.note ? item.note
    : pct === null ? 'merging…'
    : `${pct}%`;
  return (
    <div className="job">
      <div className="row">
        <strong style={{ flex: 1 }}>{item.title}</strong>
        <span className="meta">{statusText}</span>
      </div>
      <div
        className="progress-pill"
        role="progressbar"
        aria-valuenow={pct ?? 0}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Download progress ${item.title}`}
      >
        <div style={{ width: `${pct ?? 100}%` }} />
      </div>
      {item.error && <div className="field-error" role="alert">{item.error}</div>}
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
