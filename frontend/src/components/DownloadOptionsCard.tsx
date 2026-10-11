import { useStore } from '../lib/store';
import { loadSettings, saveSettings } from '../lib/settings';
import { isTauri } from '../lib/desktop';
import MultiDropdown from './MultiDropdown';
import PreferenceFields from './PreferenceFields';

/** Right column: basic format + quality, advanced behind a persisted toggle. */
export default function DownloadOptionsCard() {
  const { format, quality, container, codec, audioContainer, audioCodec, audioQuality, captionsFormat, showAdvanced, audioTracks, media, set, toggleAudioTrack, toggleCaption, captions } = useStore();
  const qualities = media?.qualities?.length ? media.qualities : ['best'];
  const heights = qualities.filter((q) => q !== 'best');
  const max = heights.length ? heights[heights.length - 1] : null;
  const tracks = media?.audioTracks ?? [];
  const caps = media?.captions ?? [];

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
      <h2>Download options</h2>
      <PreferenceFields
        value={{ format, quality, container, codec, audioContainer, audioCodec, audioQuality, captionsFormat }}
        onChange={(p) => set(p)}
        qualities={qualities}
        qualityHint={max ? ` (up to ${max}p)` : ''}
        desktop={isTauri()}
        advanced={showAdvanced}
      />
      {format === 'captions' && (
        <p className="meta" style={{ marginTop: 12 }}>
          Subtitle files only (.{captionsFormat}) — no video or audio is downloaded.
        </p>
      )}
      {format !== 'captions' && showAdvanced && (
        <MultiDropdown
          label="Audio tracks"
          options={tracks.map((t) => ({ id: t.id, label: t.label, badge: t.original ? 'Original' : undefined }))}
          selected={audioTracks}
          onToggle={toggleAudioTrack}
          emptyText="No dubbed tracks for this video."
          summaryNone="No audio"
        />
      )}
      {format !== 'audio' && showAdvanced && (
        <MultiDropdown
          label="Captions"
          options={caps.map((c) => ({ id: c.id, label: c.label, badge: c.manual ? 'Manual-only' : undefined }))}
          selected={captions}
          onToggle={toggleCaption}
          emptyText="No manual captions for this video."
          summaryNone="None"
        />
      )}
      {format === 'audio' && (
        <p className="meta" style={{ marginTop: 12 }}>
          Audio only — no captions are downloaded.
        </p>
      )}
      <label className="check" style={{ marginTop: 12 }}>
        <input
          type="checkbox"
          checked={showAdvanced}
          onChange={() => void toggleAdvanced()}
          aria-expanded={showAdvanced}
        />
        Show advanced settings
      </label>
    </div>
  );
}
