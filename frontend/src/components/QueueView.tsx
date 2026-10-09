import { useStore } from '../lib/store';
import TransferCard from './TransferCard';

/** Batch view: per-file user-end transfers (no server jobs). */
export default function QueueView() {
  const { queue, media } = useStore();
  if (media?.isPlaylist) {
    return (
      <div className="card">
        <h2>Queue · playlist ({Math.min(media.playlistCount ?? queue.length, 10)}/10)</h2>
        {queue.length === 0 && <p className="empty">Files will appear here after you press Download ZIP.</p>}
        {queue.map((j) => <TransferCard key={j.id} transferId={j.id} />)}
      </div>
    );
  }
  if (queue.length === 0) return null;
  return (
    <div className="card">
      <h2>Downloads</h2>
      {queue.map((j) => <TransferCard key={j.id} transferId={j.id} />)}
    </div>
  );
}
