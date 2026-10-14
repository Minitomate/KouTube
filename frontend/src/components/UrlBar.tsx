import { useEffect, useState } from 'react';
import { z } from 'zod';
import { useStore, applyDownloadDefaults, useLocale } from '../lib/store';
import { api } from '../lib/api';
import { loadSettings } from '../lib/settings';
import { isTauri, desktopResolve, ensureDesktopTools, inspectFailedMessage, readClipboardText } from '../lib/desktop';
import type { MediaInfo } from '../lib/api';
import { Icon, PATHS } from './icons';

/** Default selection: the video's original language track (marker, else first). */
export function defaultAudio(media: MediaInfo): string[] {
  const tracks = media.audioTracks;
  if (!tracks.length) return [];
  const orig = tracks.find((t) => t.original) ?? tracks[0];
  return [orig.id];
}

const urlSchema = z.string().url();
const YT_RE = /(youtube\.com|youtu\.be)/;

export default function UrlBar() {
  const { url, set } = useStore();
  const { lang, t } = useLocale();
  const [draft, setDraft] = useState(url);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Context-menu entry point: Paste & Inspect from anywhere reuses this
  // bar's own paste flow (clipboard read + auto-inspect). The closure is
  // safe: paste() only touches stable setters and an explicit target.
  useEffect(() => {
    const onPasteInspect = () => void paste();
    window.addEventListener('koutube:paste-inspect', onPasteInspect);
    return () => window.removeEventListener('koutube:paste-inspect', onPasteInspect);
  }, []);

  async function inspect(target?: string) {
    const value = (target ?? draft).trim();
    if (!urlSchema.safeParse(value).success) {
      setError(t('urlbar.invalid'));
      return;
    }
    if (!YT_RE.test(value)) {
      setError(t('urlbar.onlyYoutube'));
      return;
    }
    setError('');
    setLoading(true);
    set({ inspecting: true });
    // Static download defaults; a failed load keeps the current card values.
    const loadDefaults = async () => {
      try {
        const { settings } = await loadSettings();
        return applyDownloadDefaults(settings.downloadDefaults);
      } catch {
        return {};
      }
    };
    try {
      if (isTauri()) {
        try {
          await ensureDesktopTools();
        } catch (e) {
          setError(e instanceof Error
            ? t('urlbar.setupFailed', { msg: e.message })
            : t('urlbar.setupFailedShort'));
          return;
        }
        const media = await desktopResolve(value);
        set({ url: value, media, step: 1, audioTracks: defaultAudio(media), selectedVideos: (media.entries ?? []).map((e) => e.videoId), ...(await loadDefaults()) });
      } else {
        const media = await api.resolve(value);
        set({ url: value, media, step: 1, audioTracks: defaultAudio(media), selectedVideos: (media.entries ?? []).map((e) => e.videoId), ...(await loadDefaults()) });
      }
    } catch {
      setError(inspectFailedMessage(isTauri(), lang));
    } finally {
      setLoading(false);
      set({ inspecting: false });
    }
  }

  async function paste() {
    try {
      const text = isTauri()
        ? await readClipboardText()
        : await navigator.clipboard.readText();
      setDraft(text);
      if (text) void inspect(text);
    } catch {
      // Fall through to manual paste: focus + select the input so it's one keystroke.
      document.getElementById('url')?.focus();
      (document.getElementById('url') as HTMLInputElement | null)?.select?.();
      setError(isTauri() ? t('urlbar.pasteManual') : t('urlbar.clipboardBlocked'));
    }
  }

  function clear() {
    setDraft('');
    setError('');
    document.getElementById('url')?.focus();
  }

  return (
    <div className="card urlbar-card">
      <h2>{t('urlbar.heading')}</h2>
      <div className="urlbar">
        <label className="sr" htmlFor="url">{t('urlbar.label')}</label>
        <input
          id="url"
          placeholder="https://youtube.com/watch?v=…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          inputMode="url"
        />
        <button className="pill-btn tonal icon-btn" onClick={clear} disabled={!draft} aria-label={t('urlbar.clear')} title={t('urlbar.clear')}>
          <Icon d={PATHS.clear} />
        </button>
        <button className="pill-btn tonal icon-btn" onClick={paste} aria-label={t('urlbar.paste')} title={t('urlbar.paste')}>
          <Icon d={PATHS.paste} />
        </button>
        <button
          className="pill-btn filled icon-btn"
          onClick={() => inspect()}
          disabled={loading}
          aria-label={t('urlbar.inspect')}
          title={t('urlbar.inspect')}
          aria-busy={loading}
        >
          {loading ? <span className="spinner" aria-hidden="true" /> : <Icon d={PATHS.inspect} />}
        </button>
      </div>
      <div className="field-error" role="alert">{error}</div>
    </div>
  );
}
