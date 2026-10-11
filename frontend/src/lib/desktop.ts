// Tauri desktop adapter: same UX contract as the web flow, but resolve +
// download run through Rust commands (yt-dlp sidecar) instead of HTTP.
// Falls back to the web api when not running inside Tauri.
import { normalizeMedia, type MediaInfo } from './api';

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
  kind: 'video' | 'audio';
  outputContainer: string;
  quality: string;
  codec: string;
  audioTracks: string[];
  captions: string[];
  overwrite: boolean;
  splitKinds: boolean;
}

export interface DesktopEvent {
  job_id: string;
  status: string;
  percent: number;
  speed?: string | null;
  eta?: string | null;
  title?: string | null;
  filepath?: string | null;
  error?: string | null;
  note?: string | null;
}

export type CardStage = 'fetching' | 'finalizing';

export interface MappedEvent {
  kind: 'progress' | 'done' | 'error' | 'cancelled';
  percent: number;
  stage: CardStage;
  note?: string;
}

/** Client-side %/s rate over a rolling window (fallback when server omits speed). */
export function pctRate(
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
  if (e.status === 'done') return { kind: 'done', percent: 100, stage: 'finalizing' };
  if (e.status === 'error') return { kind: 'error', percent: 0, stage: 'finalizing' };
  if (e.status === 'cancelled') return { kind: 'cancelled', percent: 0, stage: 'fetching' };
  return {
    kind: 'progress',
    percent: e.percent,
    stage: e.status === 'merging' || e.status === 'retrying' ? 'finalizing' : 'fetching',
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
export function inspectFailedMessage(desktop: boolean): string {
  return desktop
    ? 'Could not inspect this video. Check the link and retry.'
    : 'Could not inspect URL. Is the backend running?';
}

export async function pickFolder(): Promise<string | null> {
  const dialog = await import('@tauri-apps/plugin-dialog');
  return dialog.open({ directory: true, multiple: false });
}

/** Folder resolution with loud errors: never silent, never stuck-busy.
 * Always prompts: persistence lives in settings, not here. */
export async function resolveOutDir(): Promise<string> {
  let picked: string | string[] | null;
  try {
    picked = await pickFolder();
  } catch (e) {
    throw new Error(e instanceof Error
      ? `folder picker failed: ${e.message}`
      : 'folder picker failed');
  }
  if (!picked || Array.isArray(picked)) throw new Error('No folder selected');
  return picked;
}

export async function getRecentLogs(): Promise<string[]> {
  const { invoke } = await tauri();
  return invoke('get_recent_logs') as Promise<string[]>;
}

export async function startDesktopDownload(
  choice: DesktopChoice,
  outDir: string,
  onEvent: (e: DesktopEvent) => void,
): Promise<{ jobId: string; stop: () => void }> {
  const { invoke, listen } = await tauri();
  const jobId = (await invoke('start_download', {
    url: choice.url,
    videoId: choice.videoId ?? null,
    container: choice.kind === 'audio' ? 'mp3' : choice.outputContainer,
    quality: choice.kind === 'audio' ? 'best' : choice.quality,
    // NOTE: Tauri exposes snake_case Rust params as camelCase — do NOT
    // "fix" these to snake_case (that breaks invoke with `missing key`).
    codec: choice.kind === 'audio' || choice.codec === 'auto' ? null : choice.codec,
    audioTracks: choice.audioTracks.filter((t) => t !== 'original'),
    captions: choice.captions,
    outDir,
    overwrite: choice.overwrite,
    splitKinds: choice.splitKinds,
  })) as string;
  const stop = await listen('dl://progress', (e) => {
    const p = e.payload as DesktopEvent;
    if (p.job_id === jobId) onEvent(p);
  });
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

export async function existingOutputs(outDir: string, videoId: string): Promise<string[]> {
  const { invoke } = await tauri();
  return invoke('existing_outputs', { outDir, videoId }) as Promise<string[]>;
}

export async function playFile(path: string): Promise<void> {
  const opener = await import('@tauri-apps/plugin-opener');
  await opener.openPath(path);
}

export async function revealFile(path: string): Promise<void> {
  const opener = await import('@tauri-apps/plugin-opener');
  await opener.revealItemInDir(path);
}

export async function ensureDesktopTools(): Promise<void> {
  const { invoke } = await tauri();
  await invoke('ensure_tools');
}
