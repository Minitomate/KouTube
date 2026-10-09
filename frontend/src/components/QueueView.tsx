import { useStore } from '../lib/store';
import JobCard from './JobCard';

/** Playlist batch view: reuses global defaults, caps at 50 jobs. */
export default function QueueView() {
  const { queue, media } = useStore();
  if (media?.isPlaylist) {
    return (
      <div className="card">
        <h2>Queue · playlist ({Math.min(media.playlistCount ?? queue.length, 50)}/50)</h2>
        {queue.length === 0 && <p className="empty">Jobs will appear here after you press Download.</p>}
        {queue.map((j) => <JobCard key={j.id} jobId={j.id} />)}
      </div>
    );
  }
  if (queue.length === 0) return null;
  return (
    <div className="card">
      <h2>Downloads</h2>
      {queue.map((j) => <JobCard key={j.id} jobId={j.id} />)}
    </div>
  );
}
