import { useStore, CODEC_LABELS, AUDIO_CONTAINERS, AUDIO_CODECS, AUDIO_QUALITIES, type Codec, type Container, type AudioContainer, type AudioQuality } from '../lib/store';
import { isTauri } from '../lib/desktop';
import MultiDropdown from './MultiDropdown';

/** Right column: condensed native dropdowns, YouTube-dialog style. */
export default function DownloadOptionsCard() {
  const { format, quality, container, codec, audioContainer, audioCodec, audioQuality, captionsFormat, audioTracks, media, set, toggleAudioTrack, toggleCaption, captions } = useStore();
  const qualities = media?.qualities?.length ? media.qualities : ['best'];
  const heights = qualities.filter((q) => q !== 'best');
  const max = heights.length ? heights[heights.length - 1] : null;
  const tracks = media?.audioTracks ?? [];
  const caps = media?.captions ?? [];
  const desktop = isTauri();
  const codecs = AUDIO_CODECS[audioContainer];
  const showQuality = audioContainer !== 'wav' && audioContainer !== 'flac' && audioCodec !== 'alac';
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
          Subtitle files only (.{captionsFormat}) — no video or audio is downloaded.
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
      {format !== 'audio' && (
        <>
          <MultiDropdown
            label="Captions"
            options={caps.map((c) => ({ id: c.id, label: c.label, badge: c.manual ? 'Manual-only' : undefined }))}
            selected={captions}
            onToggle={toggleCaption}
            emptyText="No manual captions for this video."
            summaryNone="None"
          />
          <label className="field">
            <span>Captions format</span>
            <select
              aria-label="Captions file format"
              className="select-pill"
              value={captionsFormat}
              onChange={(e) => set({ captionsFormat: e.target.value as 'srt' | 'vtt' })}
            >
              <option value="srt">SRT</option>
              <option value="vtt">VTT</option>
            </select>
          </label>
        </>
      )}
      {format === 'audio' && (
        <>
          {desktop ? (
            <div className="field-row">
              <label className="field">
                <span>Container</span>
                <select
                  aria-label="Audio container"
                  className="select-pill"
                  value={audioContainer}
                  onChange={(e) => {
                    const next = e.target.value as AudioContainer;
                    set({ audioContainer: next, audioCodec: AUDIO_CODECS[next][0].id });
                  }}
                >
                  {AUDIO_CONTAINERS.map((c) => (
                    <option key={c} value={c}>{c.toUpperCase()}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Codec</span>
                <select
                  aria-label="Audio codec"
                  className="select-pill"
                  value={audioCodec}
                  onChange={(e) => set({ audioCodec: e.target.value })}
                >
                  {codecs.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </label>
              {showQuality && (
                <label className="field">
                  <span>Quality</span>
                  <select
                    aria-label="Audio quality"
                    className="select-pill"
                    value={audioQuality}
                    onChange={(e) => set({ audioQuality: e.target.value as AudioQuality })}
                  >
                    {AUDIO_QUALITIES.map((q) => (
                      <option key={q.id} value={q.id}>{q.label}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          ) : (
            <p className="meta" style={{ marginTop: 12 }}>Audio downloads as MP3 on web.</p>
          )}
          <p className="meta" style={{ marginTop: 12 }}>
            Audio only — no captions are downloaded.
          </p>
        </>
      )}
    </div>
  );
}
