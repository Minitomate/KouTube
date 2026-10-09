import { useStore } from '../lib/store';

export default function FormatPicker() {
  const { format, set } = useStore();
  return (
    <div className="card">
      <h2>2 · Format</h2>
      <div className="segmented" role="group" aria-label="Format">
        {(['video', 'audio'] as const).map((f) => (
          <button
            key={f}
            aria-pressed={format === f}
            aria-label={f === 'video' ? 'Video format' : 'Audio format'}
            onClick={() => set({ format: f })}
          >
            {f === 'video' ? 'Video' : 'Audio'}
          </button>
        ))}
      </div>
    </div>
  );
}
