/** Skeleton shown while resolve is in flight (first + re-inspect). */
export default function MediaSkeleton() {
  return (
    <div className="card" role="status" aria-label="Loading video details">
      <div className="sk sk-thumb" />
      <div className="sk sk-line" style={{ width: '80%' }} />
      <div className="sk sk-line" style={{ width: '55%' }} />
      <div className="sk-row">
        <div className="sk sk-avatar" />
        <div className="sk sk-line" style={{ width: '40%' }} />
      </div>
    </div>
  );
}
