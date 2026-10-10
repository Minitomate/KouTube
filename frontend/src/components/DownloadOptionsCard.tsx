import { useStore } from '../lib/store';

/** Right column: condensed native dropdowns, YouTube-dialog style. */
export default function DownloadOptionsCard() {
  const { format, quality, audioTrack, captions, media, set, toggleCaption } = useStore();
  const qualities = media?.qualities?.length ? media.qualities : ['best'];
  const heights = qualities.filter((q) => q !== 'best');
  const max = heights.length ? heights[heights.length - 1] : null;
  const tracks = media?.audioTracks ?? [];
  const caps = media?.captions ?? [];
  return (
    <div className="card">
      <h2>Download options</h2>
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
      {format === 'video' && (
        <label className="field">
          <span>Quality{max ? ` (up to ${max}p)` : ''}</span>
          <select
            aria-label="Quality"
            className="select-pill"
            value={quality}
            onChange={(e) => set({ quality: e.target.value })}
          >
            {qualities.map((q) => (
              <option key={q} value={q}>{q === 'best' ? `Best${max ? ` · ${max}p` : ''}` : `${q}p`}</option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>Audio track</span>
        <select
          aria-label="Audio track"
          className="select-pill"
          value={audioTrack}
          onChange={(e) => set({ audioTrack: e.target.value })}
        >
          <option value="original">Original</option>
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
      </label>
      <fieldset className="field">
        <legend>Captions <span className="badge">Manual-only</span></legend>
        {caps.length === 0 && <p className="empty">No manual captions for this video.</p>}
        {caps.map((c) => (
          <label key={c.id} className="check">
            <input
              type="checkbox"
              aria-label={`Caption ${c.label}`}
              checked={captions.includes(c.id)}
              onChange={() => toggleCaption(c.id)}
            />
            {c.label}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
