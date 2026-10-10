import { useStore } from '../lib/store';

export default function QualityPicker() {
  const { quality, set, format, media } = useStore();
  if (format !== 'video') return null;
  // Real ceiling from resolve(); static fallback only when unknown.
  const options = media?.qualities?.length ? media.qualities : ['best'];
  const heights = options.filter((q) => q !== 'best');
  const max = heights.length ? heights[heights.length - 1] : null;
  return (
    <div className="card">
      <h2>Quality</h2>
      <div className="chips" role="group" aria-label="Quality">
        {options.map((q) => (
          <button
            key={q}
            className="chip tonal"
            aria-pressed={quality === q}
            aria-label={`Quality ${q}`}
            onClick={() => set({ quality: q })}
          >
            {q === 'best' ? (max ? `Best · ${max}p` : 'Best') : `${q}p`}
          </button>
        ))}
      </div>
      {max && (
        <p className="meta">Available up to {max}p for this video.</p>
      )}
    </div>
  );
}
