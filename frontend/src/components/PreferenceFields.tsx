import {
  AUDIO_CODECS, AUDIO_CONTAINERS, AUDIO_QUALITIES, useLocale,
  type AudioContainer, type AudioQuality, type Codec, type Container, type Format,
} from '../lib/store';
import { Icon, PATHS } from './icons';
import SingleDropdown from './SingleDropdown';

const FORMAT_ICON = { video: PATHS.video, audio: PATHS.audio, captions: PATHS.captions } as const;

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
  /** Grey out the Captions mode when the inspected video has none. */
  captionsDisabled?: boolean;
}

export default function PreferenceFields({ value, onChange, qualities, qualityHint, desktop, advanced, captionsDisabled }: Props) {
  const { t } = useLocale();
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
      <div className="segmented" role="group" aria-label={t('prefs.format')}>
        {(['video', 'audio', 'captions'] as const).map((f) => {
          const disabled = f === 'captions' && captionsDisabled;
          return (
            <button
              key={f}
              aria-pressed={format === f}
              aria-label={f === 'video' ? t('prefs.videoFormat') : f === 'audio' ? t('prefs.audioFormat') : t('prefs.captionsFormat')}
              title={disabled ? t('options.noCapsHint') : undefined}
              disabled={disabled}
              onClick={() => patch({ format: f })}
            >
              <Icon d={FORMAT_ICON[f]} size={18} />
              {f === 'video' ? t('prefs.video') : f === 'audio' ? t('prefs.audio') : t('prefs.captions')}
            </button>
          );
        })}
      </div>
      {format === 'video' && (
        <>
          <SingleDropdown
            label={`${t('prefs.quality')}${qualityHint ?? ''}`}
            options={qualities.map((q) => ({ id: q, label: q === 'best' ? t('prefs.best') : `${q}p` }))}
            value={value.quality}
            onChange={(quality) => patch({ quality })}
          />
          {advanced && (
            <div className="field-row">
              <SingleDropdown
                label={t('prefs.container')}
                options={(['mp4', 'webm', 'mkv'] as const).map((c) => ({ id: c, label: c.toUpperCase() }))}
                value={value.container}
                onChange={(container) => patch({ container: container as Container })}
              />
              <SingleDropdown
                label={t('prefs.codec')}
                options={[
                  { id: 'auto', label: t('prefs.auto') },
                  { id: 'avc', label: 'AVC (H.264)' },
                  { id: 'hevc', label: 'HEVC (H.265)' },
                  { id: 'vp9', label: 'VP9' },
                  { id: 'av1', label: 'AV1' },
                ]}
                value={value.codec}
                onChange={(codec) => patch({ codec: codec as Codec })}
              />
            </div>
          )}
        </>
      )}
      {format === 'audio' && advanced && desktop && (
        <div className="field-row">
          <SingleDropdown
            label={t('prefs.container')}
            options={AUDIO_CONTAINERS.map((c) => ({ id: c, label: c.toUpperCase() }))}
            value={value.audioContainer}
            onChange={(audioContainer) => patch({ audioContainer: audioContainer as AudioContainer })}
          />
          <SingleDropdown
            label={t('prefs.codec')}
            options={codecs.map((c) => ({ id: c.id, label: c.label }))}
            value={value.audioCodec}
            onChange={(audioCodec) => patch({ audioCodec })}
          />
          {showQuality && (
            <SingleDropdown
              label={t('prefs.quality')}
              options={AUDIO_QUALITIES.map((q) => ({ id: q.id, label: q.id === 'best' ? t('prefs.best') : q.label }))}
              value={value.audioQuality}
              onChange={(audioQuality) => patch({ audioQuality: audioQuality as AudioQuality })}
            />
          )}
        </div>
      )}
      {format === 'audio' && !desktop && (
        <p className="meta" style={{ marginTop: 12 }}>{t('prefs.mp3web')}</p>
      )}
      {format !== 'audio' && advanced && (
        <SingleDropdown
          label={t('prefs.capsFileLabel')}
          options={[{ id: 'srt', label: 'SRT' }, { id: 'vtt', label: 'VTT' }]}
          value={value.captionsFormat}
          onChange={(captionsFormat) => patch({ captionsFormat: captionsFormat as 'srt' | 'vtt' })}
        />
      )}
    </>
  );
}
