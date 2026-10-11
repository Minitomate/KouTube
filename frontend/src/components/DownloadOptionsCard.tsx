import { useStore, CODEC_LABELS, type Codec, type Container } from '../lib/store';
import MultiDropdown from './MultiDropdown';

/** Right column: condensed native dropdowns, YouTube-dialog style. */
export default function DownloadOptionsCard() {
  const { format, quality, container, codec, audioTracks, media, set, toggleAudioTrack, toggleCaption, captions } = useStore();
  const qualities = media?.qualities?.length ? media.qualities : ['best'];
  const heights = qualities.filter((q) => q !== 'best');
  const max = heights.length ? heights[heights.length - 1] : null;
  const tracks = media?.audioTracks ?? [];
  const caps = media?.captions ?? [];
  return (
    <div className="card">
      <h2>Download options</h2>
      <div className="segmented" role="group" aria-label="Format">
        {(['video', 'audio', 'captions'] as const).map((f) => (
          <button
            key={f}
            aria-pressed={format === f}
            aria-label={f === 'video' ? 'Video format' : f === 'audio' ? 'Audio format' : 'Captions format'}
            onClick={() => set({ format: f })}
          >
            {f === 'video' ? 'Video' : f === 'audio' ? 'Audio' : 'Captions'}
          </button>
        ))}
      </div>
      {format === 'video' && (
        <>
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
          <div className="field-row">
            <label className="field">
              <span>Container</span>
              <select
                aria-label="Container"
                className="select-pill"
                value={container}
                onChange={(e) => set({ container: e.target.value as Container })}
              >
                <option value="mp4">MP4</option>
                <option value="webm">WebM</option>
                <option value="mkv">MKV</option>
              </select>
            </label>
            <label className="field">
              <span>Codec</span>
              <select
                aria-label="Codec"
                className="select-pill"
                value={codec}
                onChange={(e) => set({ codec: e.target.value as Codec })}
              >
                <option value="auto">Auto</option>
                {(Object.keys(CODEC_LABELS) as Array<keyof typeof CODEC_LABELS>).map((c) => (
                  <option key={c} value={c}>{CODEC_LABELS[c]}</option>
                ))}
              </select>
            </label>
          </div>
        </>
      )}
      {format === 'captions' && (
        <p className="meta" style={{ marginTop: 12 }}>
          Subtitle files only (.srt) — no video or audio is downloaded.
        </p>
      )}
      {format !== 'captions' && (
        <MultiDropdown
          label="Audio tracks"
          options={tracks.map((t) => ({ id: t.id, label: t.label, badge: t.original ? 'Original' : undefined }))}
          selected={audioTracks}
          onToggle={toggleAudioTrack}
          emptyText="No dubbed tracks for this video."
          summaryNone="No audio"
        />
      )}
      <MultiDropdown
        label="Captions"
        options={caps.map((c) => ({ id: c.id, label: c.label, badge: c.manual ? 'Manual-only' : undefined }))}
        selected={captions}
        onToggle={toggleCaption}
        emptyText="No manual captions for this video."
        summaryNone="None"
      />
    </div>
  );
}
