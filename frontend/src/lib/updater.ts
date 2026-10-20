// Desktop auto-update: stable GitHub releases via the Tauri updater plugin.
// Web builds have no updater: every entry here degrades to null/no-op.
// Release notes come from the manifest body: rendered as plain text only.
import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater';
import { isTauri, isAndroid } from './desktop';
import { localeTag, t, type Locale } from './i18n';
import { useStore } from './store';

export const RELEASES_URL = 'https://github.com/Minitomate/KouTube/releases/latest';
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateInfo {
  version: string;
  notes: string | null;
  pubDate: string | null;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

/** Daily gate: auto-check at most once per 24h (null = never checked). Pure. */
export function shouldAutoCheck(autoCheck: boolean, lastCheck: number | null, now: number = Date.now()): boolean {
  if (!autoCheck) return false;
  if (lastCheck == null) return true;
  return now - lastCheck >= UPDATE_CHECK_INTERVAL_MS;
}

// A pending Update holds a Rust-side resource: close it when superseded.
let pending: Update | null = null;

// One backend check at a time: concurrent callers share the in-flight
// promise, so a second check can never close the first caller's pending
// Update out from under it.
let inflight: Promise<UpdateInfo | null> | null = null;

async function discardPending(): Promise<void> {
  const prev = pending;
  pending = null;
  if (prev) await prev.close().catch(() => { /* best-effort */ });
}

export async function dismissPendingUpdate(): Promise<void> {
  await discardPending();
}

/** Null when up to date (or not on desktop). Keeps the pending Update for download. */
export function checkForUpdate(): Promise<UpdateInfo | null> {
  // Android ships as a sideloaded APK: updates are a manual reinstall.
  if (!isTauri() || isAndroid()) return Promise.resolve(null);
  if (!inflight) {
    inflight = (async (): Promise<UpdateInfo | null> => {
      await discardPending();
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (!update) return null;
      pending = update;
      return { version: update.version, notes: update.body ?? null, pubDate: update.date ?? null };
    })().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/** Release date for display; null when missing or unparsable. Pure. */
export function formatReleaseDate(iso: string | null, locale?: Locale): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toLocaleDateString(locale ? localeTag(locale) : undefined);
}

/** Downloads the pending update (re-checks when missing); install is separate. */
export async function downloadPendingUpdate(onProgress: (p: UpdateProgress) => void, locale: Locale = 'en'): Promise<void> {
  if (!pending) await checkForUpdate();
  const update = pending;
  if (!update) throw new Error(t(locale, 'up.noUpdate'));
  let downloaded = 0;
  let total: number | null = null;
  await update.download((e: DownloadEvent) => {
    if (e.event === 'Started') {
      total = e.data.contentLength ?? null;
      onProgress({ downloaded: 0, total });
    } else if (e.event === 'Progress') {
      downloaded += e.data.chunkLength;
      onProgress({ downloaded, total });
    }
  });
  onProgress({ downloaded, total });
}

/** Installs the downloaded update. Windows exits inside install;
 *  Linux/macOS return and must relaunch to run the new version. */
export async function installPendingUpdate(locale: Locale = 'en'): Promise<void> {
  const update = pending;
  if (!update) throw new Error(t(locale, 'up.nothingDl'));
  await update.install();
  pending = null;
}

export async function relaunchApp(): Promise<void> {
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}

export async function getAppVersion(): Promise<string> {
  if (!isTauri()) return 'web';
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}

/** Fallback for package types that can't self-update (deb/rpm) + web. */
export async function openReleasesPage(): Promise<void> {
  const { openExternal } = await import('./desktop');
  await openExternal(RELEASES_URL);
}

function progressPercent(downloaded: number, total: number | null): number | null {
  if (total == null || total <= 0) return null;
  return Math.min(100, Math.round((downloaded / total) * 100));
}

/** Shared check flow (boot + manual): drives the store fields the banner
 *  and the Settings card read. Stamps lastUpdateCheck only on success so
 *  an offline launch retries on the next launch instead of waiting 24h. */
export async function runUpdateCheck(locale: Locale = 'en'): Promise<boolean> {
  const { set } = useStore.getState();
  set({ updateStatus: 'checking', updateError: null });
  try {
    const info = await checkForUpdate();
    try {
      const { loadSettings, saveSettings } = await import('./settings');
      const { settings } = await loadSettings();
      await saveSettings({ ...settings, lastUpdateCheck: Date.now() });
    } catch { /* stamp is best-effort */ }
    if (info) {
      set({
        updateStatus: 'available', updateVersion: info.version,
        updateNotes: info.notes, updatePubDate: info.pubDate,
        updateDismissed: false,
      });
      return true;
    }
    set({ updateStatus: 'uptodate' });
    return false;
  } catch (e) {
    set({ updateStatus: 'error', updateError: e instanceof Error ? e.message : t(locale, 'up.checkFailed') });
    return false;
  }
}

/** Shared download+install flow: drives the same store fields. Reaching
 *  'ready' means Linux/macOS (Windows exits inside install). A failed
 *  install (deb/rpm, locked files) lands on 'error' with the fallback. */
export async function runUpdateDownload(locale: Locale = 'en'): Promise<void> {
  useStore.getState().set({ updateStatus: 'downloading', updateProgress: null, updateError: null });
  try {
    await downloadPendingUpdate(({ downloaded, total }) =>
      useStore.getState().set({ updateProgress: progressPercent(downloaded, total) }),
      locale,
    );
    await installPendingUpdate(locale);
    useStore.getState().set({ updateStatus: 'ready', updateProgress: 100 });
  } catch (e) {
    useStore.getState().set({
      updateStatus: 'error',
      updateError: e instanceof Error ? e.message : t(locale, 'set.updateFailed'),
    });
  }
}
