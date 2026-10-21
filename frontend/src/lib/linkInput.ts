import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { api, type MediaInfo } from './api';
import { loadSettings } from './settings';
import { applyDownloadDefaults, useLocale, useStore } from './store';
import { isAndroid, isTauri, desktopResolve, ensureDesktopTools, inspectFailedMessage, readClipboardText } from './desktop';

const urlSchema = z.string().url();
const YT_RE = /(youtube\.com|youtu\.be)/;

/** Default selection: the video's original language track (marker, else first). */
export function defaultAudio(media: MediaInfo): string[] {
  const tracks = media.audioTracks;
  if (!tracks.length) return [];
  const orig = tracks.find((t) => t.original) ?? tracks[0];
  return [orig.id];
}

export interface LinkInput {
  draft: string;
  setDraft: (value: string) => void;
  error: string;
  loading: boolean;
  inspect: (target?: string) => Promise<boolean>;
  paste: () => Promise<void>;
  clear: () => void;
}

/** Link field state shared by the desktop card and the Android bottom dock. */
export function useLinkInput(): LinkInput {
  const { url, set } = useStore();
  const { lang, t } = useLocale();
  const [draft, setDraft] = useState(url);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function inspect(target?: string): Promise<boolean> {
    const value = (target ?? draft).trim();
    if (!urlSchema.safeParse(value).success) {
      setError(t('urlbar.invalid'));
      return false;
    }
    if (!YT_RE.test(value)) {
      setError(t('urlbar.onlyYoutube'));
      return false;
    }
    // A valid inspect hides the Android keyboard so the result card is visible.
    if (isAndroid() && document.activeElement instanceof HTMLElement) document.activeElement.blur();
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
          return false;
        }
        const media = await desktopResolve(value);
        set({ url: value, media, step: 1, audioTracks: defaultAudio(media), selectedVideos: (media.entries ?? []).map((e) => e.videoId), ...(await loadDefaults()) });
      } else {
        const media = await api.resolve(value);
        set({ url: value, media, step: 1, audioTracks: defaultAudio(media), selectedVideos: (media.entries ?? []).map((e) => e.videoId), ...(await loadDefaults()) });
      }
      return true;
    } catch {
      setError(inspectFailedMessage(isTauri(), lang));
      return false;
    } finally {
      setLoading(false);
      set({ inspecting: false });
    }
  }

  async function paste(): Promise<void> {
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

  function clear(): void {
    setDraft('');
    setError('');
    document.getElementById('url')?.focus();
  }

  // Context-menu entry point: Paste & Inspect from anywhere reuses this
  // bar's own paste flow (clipboard read + auto-inspect). Ref keeps the
  // listener stable while paste() follows the latest draft.
  const pasteRef = useRef(paste);
  pasteRef.current = paste;
  useEffect(() => {
    const onPasteInspect = () => void pasteRef.current();
    window.addEventListener('koutube:paste-inspect', onPasteInspect);
    return () => window.removeEventListener('koutube:paste-inspect', onPasteInspect);
  }, []);

  return { draft, setDraft, error, loading, inspect, paste, clear };
}
