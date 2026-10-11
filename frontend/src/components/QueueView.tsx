import { useStore } from '../lib/store';
import TransferCard from './TransferCard';

interface Props {
  onRemove: (id: string) => void;
  onClearFinished: () => void;
  onCancelAll: () => void;
}

const TERMINAL = ['done', 'error', 'cancelled'];

/** Batch view: per-file user-end transfers (no server jobs). */
export default function QueueView({ onRemove, onClearFinished, onCancelAll }: Props) {
  const { queue, media } = useStore();
  const active = queue.filter((q) => !TERMINAL.includes(q.status));
  const finished = queue.filter((q) => TERMINAL.includes(q.status));
  return (
    <div className="card queue-grid">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>
          {media?.isPlaylist
            ? `Queue · playlist (${Math.min(media.playlistCount ?? queue.length, 10)}/10)`
            : 'Downloads'}
        </h2>
        <div className="row">
          {finished.length > 0 && (
            <button className="pill-btn text" style={{ minHeight: 36 }} onClick={onClearFinished}>
              Clear finished
            </button>
          )}
          {active.length > 0 && (
            <button className="pill-btn text" style={{ minHeight: 36 }} onClick={onCancelAll}>
              Cancel all
            </button>
          )}
        </div>
      </div>
      {media?.isPlaylist && queue.length === 0 && (
        <p className="empty">Files will appear here after you press Download ZIP.</p>
      )}
      {!media?.isPlaylist && queue.length === 0 && (
        <p className="empty">Nothing here yet.</p>
      )}
      <div className="queue-cards">
        {queue.map((j) => <TransferCard key={j.id} transferId={j.id} onRemove={onRemove} />)}
      </div>
    </div>
  );
}
