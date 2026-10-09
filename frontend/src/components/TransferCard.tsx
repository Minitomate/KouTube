import { useStore } from '../lib/store';

export default function TransferCard({ transferId }: { transferId: string }) {
  const item = useStore((s) => s.queue.find((q) => q.id === transferId));
  if (!item) return null;
  const pct = item.total ? Math.round((item.loaded / item.total) * 100) : null;
  return (
    <div className="job">
      <div className="row">
        <strong style={{ flex: 1 }}>{item.title}</strong>
        <span className="meta">
          {item.status === 'done' ? 'saved ✓'
            : item.status === 'error' ? `failed: ${item.error ?? ''}`
            : item.status === 'cancelled' ? 'cancelled'
            : pct === null ? 'merging…'
            : `${pct}%`}
        </span>
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
    </div>
  );
}
