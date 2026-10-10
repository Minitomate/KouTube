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
  container: string;
  quality: string;
  audioTrack: string;
  captions: string[];
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

/** Folder resolution with loud errors: never silent, never stuck-busy. */
export async function resolveOutDir(): Promise<string> {
  const cached = localStorage.getItem('koutube-outdir');
  if (cached) return cached;
  let picked: string | string[] | null;
  try {
    picked = await pickFolder();
  } catch (e) {
    throw new Error(e instanceof Error
      ? `folder picker failed: ${e.message}`
      : 'folder picker failed');
  }
  if (!picked || Array.isArray(picked)) throw new Error('No folder selected');
  localStorage.setItem('koutube-outdir', picked);
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
    container: choice.container === 'audio' ? 'mp3' : 'mp4',
    quality: choice.quality,
    // NOTE: Tauri exposes snake_case Rust params as camelCase — do NOT
    // "fix" these to snake_case (that breaks invoke with `missing key`).
    audioTrack: choice.audioTrack === 'original' ? null : choice.audioTrack,
    captions: choice.captions,
    outDir,
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

export async function ensureDesktopTools(): Promise<void> {
  const { invoke } = await tauri();
  await invoke('ensure_tools');
}
