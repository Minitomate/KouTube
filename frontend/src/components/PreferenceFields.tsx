import {
  AUDIO_CODECS, AUDIO_CONTAINERS, AUDIO_QUALITIES,
  type AudioContainer, type AudioQuality, type Codec, type Container, type Format,
} from '../lib/store';

/** Full download-preference fieldset, controlled. The card binds it to the
 * store (advanced groups gated by the toggle); Settings binds it to the
 * settings object (always expanded). Track pickers stay card-local. */
export interface PreferenceValues {
  format: Format;
  quality: string;
  container: Container;
  codec: Codec;
  audioContainer: AudioContainer;
  audioCodec: string;
  audioQuality: AudioQuality;
  captionsFormat: 'srt' | 'vtt';
}

interface Props {
  value: PreferenceValues;
  onChange: (patch: Partial<PreferenceValues>) => void;
  /** Quality option values (card: media heights; settings: static list). */
  qualities: string[];
  qualityHint?: string;
  /** Audio encodes are desktop-only; web shows an MP3 note instead. */
  desktop: boolean;
  advanced: boolean;
}

export default function PreferenceFields({ value, onChange, qualities, qualityHint, desktop, advanced }: Props) {
  const { format } = value;
  const codecs = AUDIO_CODECS[value.audioContainer];
  const showQuality =
    value.audioContainer !== 'wav' && value.audioContainer !== 'flac' && value.audioCodec !== 'alac';
  function patch(p: Partial<PreferenceValues>) {
    // Container owns its codec: switching resets to the container default.
    if (p.audioContainer && p.audioContainer !== value.audioContainer) {
      onChange({ ...p, audioCodec: AUDIO_CODECS[p.audioContainer][0].id });
    } else {
      onChange(p);
    }
  }
  return (
    <>
      <div className="segmented" role="group" aria-label="Format">
        {(['video', 'audio', 'captions'] as const).map((f) => (
          <button
            key={f}
            aria-pressed={format === f}
            aria-label={f === 'video' ? 'Video format' : f === 'audio' ? 'Audio format' : 'Captions format'}
            onClick={() => patch({ format: f })}
          >
            {f === 'video' ? 'Video' : f === 'audio' ? 'Audio' : 'Captions'}
          </button>
        ))}
      </div>
      {format === 'video' && (
        <>
          <label className="field">
            <span>Quality{qualityHint ?? ''}</span>
            <select
              aria-label="Quality"
              className="select-pill"
              value={value.quality}
              onChange={(e) => patch({ quality: e.target.value })}
            >
              {qualities.map((q) => (
                <option key={q} value={q}>{q === 'best' ? 'Best' : `${q}p`}</option>
              ))}
            </select>
          </label>
          {advanced && (
            <div className="field-row">
              <label className="field">
                <span>Container</span>
                <select
                  aria-label="Container"
                  className="select-pill"
                  value={value.container}
                  onChange={(e) => patch({ container: e.target.value as Container })}
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
                  value={value.codec}
                  onChange={(e) => patch({ codec: e.target.value as Codec })}
                >
                  <option value="auto">Auto</option>
                  <option value="avc">AVC (H.264)</option>
                  <option value="hevc">HEVC (H.265)</option>
                  <option value="vp9">VP9</option>
                  <option value="av1">AV1</option>
                </select>
              </label>
            </div>
          )}
        </>
      )}
      {format === 'audio' && advanced && desktop && (
        <div className="field-row">
          <label className="field">
            <span>Container</span>
            <select
              aria-label="Audio container"
              className="select-pill"
              value={value.audioContainer}
              onChange={(e) => patch({ audioContainer: e.target.value as AudioContainer })}
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
              value={value.audioCodec}
              onChange={(e) => patch({ audioCodec: e.target.value })}
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
                value={value.audioQuality}
                onChange={(e) => patch({ audioQuality: e.target.value as AudioQuality })}
              >
                {AUDIO_QUALITIES.map((q) => (
                  <option key={q.id} value={q.id}>{q.label}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {format === 'audio' && !desktop && (
        <p className="meta" style={{ marginTop: 12 }}>Audio downloads as MP3 on web.</p>
      )}
      {format !== 'audio' && advanced && (
        <label className="field">
          <span>Captions format</span>
          <select
            aria-label="Captions file format"
            className="select-pill"
            value={value.captionsFormat}
            onChange={(e) => patch({ captionsFormat: e.target.value as 'srt' | 'vtt' })}
          >
            <option value="srt">SRT</option>
            <option value="vtt">VTT</option>
          </select>
        </label>
      )}
    </>
  );
}
