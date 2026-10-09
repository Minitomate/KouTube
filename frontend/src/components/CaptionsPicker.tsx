import { useStore } from '../lib/store';

export default function CaptionsPicker() {
  const { media, captions, toggleCaption } = useStore();
  const tracks = media?.captions ?? [];
  return (
    <div className="card">
      <h2>Captions</h2>
      {tracks.length === 0 ? (
        <p className="empty">No captions available for this video.</p>
      ) : (
        <div className="chips" role="group" aria-label="Captions">
          {tracks.map((c) => (
            <button
              key={c.id}
              className="chip filter"
              aria-pressed={captions.includes(c.id)}
              aria-label={`Caption ${c.label}`}
              onClick={() => toggleCaption(c.id)}
            >
              {c.label}
              {c.manual && <span className="badge">Manual-only</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
