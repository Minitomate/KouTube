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
}

export async function pickFolder(): Promise<string | null> {
  const dialog = await import('@tauri-apps/plugin-dialog');
  return dialog.open({ directory: true, multiple: false });
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
