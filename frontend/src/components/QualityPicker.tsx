import { QUALITIES, useStore } from '../lib/store';

export default function QualityPicker() {
  const { quality, set, format } = useStore();
  if (format !== 'video') return null;
  return (
    <div className="card">
      <h2>Quality</h2>
      <div className="chips" role="group" aria-label="Quality">
        {QUALITIES.map((q) => (
          <button
            key={q}
            className="chip tonal"
            aria-pressed={quality === q}
            aria-label={`Quality ${q}`}
            onClick={() => set({ quality: q })}
          >
            {q === 'best' ? 'Best' : `${q}p`}
          </button>
        ))}
      </div>
    </div>
  );
}
