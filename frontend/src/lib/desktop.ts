// Tauri desktop adapter: same UX contract as the web flow, but resolve +
// download run through Rust commands (yt-dlp sidecar) instead of HTTP.
// Falls back to the web api when not running inside Tauri.
import { normalizeMedia, type MediaInfo } from './api';
import { t, type Locale } from './i18n';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
type ListenFn = (
  event: string,
  handler: (e: { payload: unknown }) => void,
) => Promise<() => void>;

async function tauri(): Promise<{ invoke: InvokeFn; listen: ListenFn }> {
  const core = await import('@tauri-apps/api/core');
  const event = await import('@tauri-apps/api/event');
  return {
    invoke: core.invoke as unknown as InvokeFn,
    listen: event.listen as unknown as ListenFn,
  };
}

export async function desktopResolve(url: string): Promise<MediaInfo> {
  const { invoke } = await tauri();
  return normalizeMedia(await invoke('resolve', { url }));
}

export interface DesktopChoice {
  url: string;
  videoId?: string;
  kind: 'video' | 'audio' | 'captions';
  outputContainer: string;
  quality: string;
  codec: string;
  audioCodec: string;
  audioQuality: string | null;
  captionsFormat: string;
  audioTracks: string[];
  captions: string[];
  overwrite: boolean;
  splitKinds: boolean;
}

export interface DesktopEvent {
  job_id: string;
  status: string;
  percent: number;
  loaded?: number | null;
  total?: number | null;
  speed?: string | null;
  eta?: string | null;
  title?: string | null;
  filepath?: string | null;
  error?: string | null;
  note?: string | null;
}

export type CardStage = 'downloading' | 'processing';

export interface MappedEvent {
  kind: 'progress' | 'done' | 'error' | 'cancelled';
  percent: number;
  /** Real byte counts when the sidecar reports them; null = unknown. */
  loaded: number | null;
  total: number | null;
  stage: CardStage;
  note?: string;
}

/** Client ETA (seconds) from percent velocity for percent-only progress
 * without byte counts. Velocity over the sample window, so the estimate
 * tightens as points accumulate; needs span so early points can't invent
 * precision. Null when unknowable (bounds, too few points, stalled). */
export function percentETA(
  samples: Array<{ t: number; p: number }>,
  percent: number,
  now: number = Date.now(),
  windowMs = 60000,
  minSpanMs = 3000,
): number | null {
  if (percent <= 0 || percent >= 100) return null;
  const fresh = samples.filter((s) => now - s.t <= windowMs);
  if (fresh.length < 3) return null;
  if (now - fresh[0].t < minSpanMs) return null;
  const dv = percent - fresh[0].p;
  if (dv <= 0) return null;
  const v = dv / ((now - fresh[0].t) / 1000);
  if (v <= 0) return null;
  return Math.max(0, (100 - percent) / v);
}

/** Client-side rate over a rolling window (fallback when server omits speed). */
export function byteRate(
  samples: Array<{ t: number; p: number }>,
  now: number,
  windowMs = 5000,
): number | null {
  const fresh = samples.filter((s) => now - s.t <= windowMs);
  if (fresh.length < 2) return null;
  const dt = (now - fresh[0].t) / 1000;
  const dp = fresh[fresh.length - 1].p - fresh[0].p;
  if (dt <= 0 || dp <= 0) return null;
  return dp / dt;
}

/** Pure mapping: sidecar event -> card state. Unit-tested, no side effects. */
export function mapDesktopEvent(e: DesktopEvent): MappedEvent {
  if (e.status === 'done') return { kind: 'done', percent: 100, loaded: null, total: null, stage: 'processing' };
  if (e.status === 'error') return { kind: 'error', percent: 0, loaded: null, total: null, stage: 'processing' };
  if (e.status === 'cancelled') return { kind: 'cancelled', percent: 0, loaded: null, total: null, stage: 'downloading' };
  // Retrying re-downloads: never show it as processing.
  const processing = e.status === 'merging';
  const hasBytes = e.loaded != null && (e.total ?? 0) > 0;
  return {
    kind: 'progress',
    percent: hasBytes
      ? Math.min(100, Math.round(((e.loaded as number) / (e.total as number)) * 100))
      : e.percent,
    loaded: hasBytes ? (e.loaded as number) : null,
    total: hasBytes ? (e.total as number) : null,
    stage: processing ? 'processing' : 'downloading',
    note: [e.speed, e.eta ? `ETA ${e.eta}` : '', e.error ?? '', e.note ?? '']
      .filter(Boolean).join(' · ') || undefined,
  };
}

/** Clipboard read: Tauri plugin on desktop (webview API is denied there). */
export async function readClipboardText(): Promise<string> {
  const clipboard = await import('@tauri-apps/plugin-clipboard-manager');
  return clipboard.readText();
}

/** Inspect failure text: desktop has no backend, so say so plainly. */
export function inspectFailedMessage(desktop: boolean, locale: Locale = 'en'): string {
  return desktop
    ? t(locale, 'desktop.inspectDesktop')
    : t(locale, 'desktop.inspectWeb');
}

export async function pickFolder(): Promise<string | null> {
  const dialog = await import('@tauri-apps/plugin-dialog');
  return dialog.open({ directory: true, multiple: false });
}

/** Folder resolution with loud errors: never silent, never stuck-busy.
 * Always prompts: persistence lives in settings, not here. */
export async function resolveOutDir(locale: Locale = 'en'): Promise<string> {
  let picked: string | string[] | null;
  try {
    picked = await pickFolder();
  } catch (e) {
    throw new Error(e instanceof Error
      ? t(locale, 'desktop.folderFailed', { msg: e.message })
      : t(locale, 'desktop.folderFailedShort'));
  }
  if (!picked || Array.isArray(picked)) throw new Error(t(locale, 'desktop.noFolder'));
  return picked;
}

export async function getRecentLogs(): Promise<string[]> {
  const { invoke } = await tauri();
  return invoke('get_recent_logs') as Promise<string[]>;
}

export const DEFAULT_WINDOW_W = 1280;
export const DEFAULT_WINDOW_H = 900;
const MIN_WINDOW_W = 480;
const MIN_WINDOW_H = 700;

/** Launch size: remembered dimensions clamped to the current monitor,
 * falling back to the defaults. Pure and unit-tested. */
export function resolveWindowSize(
  saved: { w: number; h: number } | null,
  availW: number,
  availH: number,
): { w: number; h: number } {
  const clamp = (v: number, lo: number, hi: number) =>
    Math.min(Math.max(Number.isFinite(v) ? v : lo, lo), Math.max(hi, lo));
  return {
    w: clamp(saved?.w ?? DEFAULT_WINDOW_W, MIN_WINDOW_W, availW - 80),
    h: clamp(saved?.h ?? DEFAULT_WINDOW_H, MIN_WINDOW_H, availH - 120),
  };
}

export async function startDesktopDownload(
  choice: DesktopChoice,
  outDir: string,
  onEvent: (e: DesktopEvent) => void,
): Promise<{ jobId: string; stop: () => void }> {
  const { invoke, listen } = await tauri();
  // Listen BEFORE invoke: the sidecar emits queued + first progress inside
  // the invoke round-trip, and anything in that window would otherwise be
  // missed (fast jobs would jump straight from preparing to saved).
  // Pre-resolution events buffer briefly, then replay for our job only.
  let jobId: string | null = null;
  const pending: Array<{ payload: unknown }> = [];
  const stop = await listen('dl://progress', (e) => {
    const p = e.payload as DesktopEvent;
    if (jobId === null) {
      pending.push(e);
      if (pending.length > 50) pending.shift();
      return;
    }
    if (p.job_id === jobId) onEvent(p);
  });
  try {
    jobId = (await invoke('start_download', {
      url: choice.url,
      videoId: choice.videoId ?? null,
      container: choice.kind === 'captions' ? 'srt' : choice.outputContainer,
      quality: choice.kind === 'audio' ? 'best' : choice.quality,
      // NOTE: Tauri exposes snake_case Rust params as camelCase — do NOT
      // "fix" these to snake_case (that breaks invoke with `missing key`).
      codec: choice.kind === 'audio' || choice.codec === 'auto' ? null : choice.codec,
      audioCodec: choice.kind === 'audio' ? choice.audioCodec : null,
      audioQuality: choice.kind === 'audio' ? choice.audioQuality : null,
      captionsFormat: choice.captionsFormat,
      audioTracks: choice.audioTracks.filter((t) => t !== 'original'),
      captions: choice.captions,
      captionsOnly: choice.kind === 'captions',
      outDir,
      overwrite: choice.overwrite,
      splitKinds: choice.splitKinds,
    })) as string;
  } catch (err) {
    stop();
    throw err;
  }
  // Synchronous replay: no listener callback can interleave, so nothing is
  // lost or delivered twice.
  for (const e of pending.splice(0)) {
    const p = e.payload as DesktopEvent;
    if (p.job_id === jobId) onEvent(p);
  }
  return { jobId, stop };
}

export async function cancelDesktopDownload(jobId: string): Promise<void> {
  const { invoke } = await tauri();
  await invoke('cancel_download', { jobId });
}

export async function trashDownload(path: string): Promise<void> {
  const { invoke } = await tauri();
  await invoke('trash_file', { path });
}

/** Save dialog for the debug log; null when the user cancels. */
export async function pickSaveLogPath(defaultName: string): Promise<string | null> {
  const dialog = await import('@tauri-apps/plugin-dialog');
  return dialog.save({ defaultPath: defaultName, filters: [{ name: 'Text', extensions: ['txt'] }] });
}

/** Write user-picked text (debug log) via the backend. */
export async function saveTextFile(path: string, contents: string): Promise<void> {
  const { invoke } = await tauri();
  await invoke('save_text_file', { path, contents });
}

export async function existingOutputs(outDir: string, videoId: string): Promise<string[]> {
  const { invoke } = await tauri();
  return invoke('existing_outputs', { outDir, videoId }) as Promise<string[]>;
}

export async function playFile(path: string): Promise<void> {
  // Rust-side `play_file`: validates the path against the download folder,
  // then opens it with the OS default handler. The JS `open_path` command
  // stays unused — its static scope cannot cover a user-chosen folder.
  const { invoke } = await tauri();
  await invoke('play_file', { path });
}

export const YOUTUBE_TERMS_URL = 'https://www.youtube.com/t/terms';

/** Creator socials (verified live). Icons live in components/icons. */
export interface CreatorLink {
  id: 'github' | 'youtube' | 'instagram' | 'discord';
  label: string;
  url: string;
}
export const CREATOR_LINKS: CreatorLink[] = [
  { id: 'github', label: 'GitHub', url: 'https://github.com/Minitomate' },
  { id: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/@minitomate' },
  { id: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/minitomate/' },
  { id: 'discord', label: 'Discord', url: 'https://discord.gg/T3KNuWu4KB' },
];

/** Open any external link (desktop opener, plain tab on web). */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const opener = await import('@tauri-apps/plugin-opener');
    await opener.openUrl(url);
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

/** Open the YouTube Terms in a browser (desktop opener, plain tab on web). */
export async function openTerms(): Promise<void> {
  await openExternal(YOUTUBE_TERMS_URL);
}

export async function revealFile(path: string): Promise<void> {
  const opener = await import('@tauri-apps/plugin-opener');
  await opener.revealItemInDir(path);
}

export async function ensureDesktopTools(): Promise<void> {
  const { invoke } = await tauri();
  await invoke('ensure_tools');
}
