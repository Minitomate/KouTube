import { useStore } from '../lib/store';

function mb(n: number) {
  return `${(n / 1048576).toFixed(1)} MB`;
}

export default function TransferCard({ transferId }: { transferId: string }) {
  const item = useStore((s) => s.queue.find((q) => q.id === transferId));
  if (!item) return null;
  // Totals can be estimates (mux): never render over 100%. Once every
  // expected byte arrived but the stream continues, say so honestly.
  const raw = item.total ? Math.round((item.loaded / item.total) * 100) : null;
  const pct = raw === null ? null : Math.min(100, raw);
  const finalizing = item.status === 'working' &&
    (item.stage === 'finalizing' || (item.total !== null && item.loaded >= item.total));
  const statusText =
    item.status === 'done' ? 'saved ✓'
    : item.status === 'error' ? `failed: ${item.error ?? ''}`
    : item.status === 'cancelled' ? 'cancelled'
    : item.stage === 'preparing' ? 'preparing…'
    : finalizing ? `Finalizing… ${mb(item.loaded)} received`
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
        </details>
      )}
    </div>
  );
}
