import { useEffect } from 'react';
import { useStore, useLocale } from '../lib/store';
import { loadSettings, saveSettings } from '../lib/settings';
import { isTauri } from '../lib/desktop';
import MultiDropdown from './MultiDropdown';
import PreferenceFields from './PreferenceFields';
import Switch from './Switch';
import { displayLabel } from '../lib/lang';

/** Right column: basic format + quality, advanced behind a persisted toggle. */
export default function DownloadOptionsCard() {
  const { format, quality, container, codec, audioContainer, audioCodec, audioQuality, captionsFormat, showAdvanced, audioTracks, media, set, toggleAudioTrack, toggleCaption, captions } = useStore();
  const { lang, t } = useLocale();
  const qualities = media?.qualities?.length ? media.qualities : ['best'];
  const heights = qualities.filter((q) => q !== 'best');
  const max = heights.length ? heights[heights.length - 1] : null;
  const tracks = media?.audioTracks ?? [];
  // Playlist resolve carries no caption tracks: offer a short fixed list so
  // captions mode stays usable (applied per selected video at download).
  const caps = media?.isPlaylist
    ? [{ id: 'en', label: 'en', lang: 'en', manual: true }, { id: 'es', label: 'es', lang: 'es', manual: true }]
    : (media?.captions ?? []).filter((c) => c.manual);
  const hasMedia = media != null && !media.isPlaylist;
  const noCaps = hasMedia && caps.length === 0;

  // Caption-less video while in captions mode: fall back to video.
  useEffect(() => {
    if (format === 'captions' && noCaps) set({ format: 'video' });
  }, [format, noCaps, set]);

  async function toggleAdvanced() {
    const next = !showAdvanced;
    set({ showAdvanced: next });
    try {
      const { settings } = await loadSettings();
      await saveSettings({ ...settings, showAdvanced: next });
    } catch { /* store stands; next load restores the saved value */ }
  }

  return (
    <div className="card">
      <h2>{t('options.heading')}</h2>
      <PreferenceFields
        value={{ format, quality, container, codec, audioContainer, audioCodec, audioQuality, captionsFormat }}
        onChange={(p) => set(p)}
        qualities={qualities}
        qualityHint={max ? t('options.upTo', { q: max }) : ''}
        desktop={isTauri()}
        advanced={showAdvanced}
        captionsDisabled={noCaps}
      />
      {format === 'captions' && (
        <p className="meta" style={{ marginTop: 12 }}>
          {t('options.subsOnly', { fmt: captionsFormat })}
        </p>
      )}
      {(format === 'audio' || (format !== 'captions' && showAdvanced)) && (
        <MultiDropdown
          label={t('options.audioTracks')}
          options={tracks.map((tr) => ({ id: tr.id, label: displayLabel(tr.id, tr.label, lang), badge: tr.original ? t('options.original') : undefined }))}
          selected={audioTracks}
          onToggle={toggleAudioTrack}
          emptyText={t('options.noDubbed')}
          summaryNone={t('options.noAudio')}
        />
      )}
      {(format === 'captions' || (format !== 'audio' && showAdvanced)) && (
        <MultiDropdown
          label={t('options.captions')}
          options={caps.map((c) => ({ id: c.id, label: displayLabel(c.id, c.label, lang), badge: c.manual ? t('options.badgeManual') : t('options.badgeAuto') }))}
          selected={captions}
          onToggle={toggleCaption}
          emptyText={t('options.noManual')}
          summaryNone={t('options.none')}
          disabled={noCaps}
          disabledHint={t('options.noCapsHint')}
        />
      )}
      {format === 'audio' && (
        <p className="meta" style={{ marginTop: 12 }}>
          {t('options.audioOnly')}
        </p>
      )}
      <div style={{ marginTop: 12 }}>
        <Switch checked={showAdvanced} onChange={() => void toggleAdvanced()} label={t('options.advanced')} />
      </div>
    </div>
  );
}
