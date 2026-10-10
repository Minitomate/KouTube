import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const listenMock = vi.fn();
const openMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (...args: unknown[]) => openMock(...args),
}));

import {
  cancelDesktopDownload,
  pickFolder,
  startDesktopDownload,
} from './desktop';

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
  openMock.mockReset();
});

describe('desktop adapter', () => {
  it('maps web choices to Tauri camelCase invoke args', async () => {
    invokeMock.mockResolvedValue('job-1');
    listenMock.mockResolvedValue(() => {});
    await startDesktopDownload(
      { url: 'https://www.youtube.com/watch?v=x', container: 'audio', quality: 'best', audioTrack: 'original', captions: ['en'] },
      '/tmp/out',
      () => {},
    );
    expect(invokeMock).toHaveBeenCalledWith('start_download', {
      url: 'https://www.youtube.com/watch?v=x',
      container: 'mp3',
      quality: 'best',
      // Tauri exposes snake_case Rust params as camelCase: assert exact keys.
      audioTrack: null,
      captions: ['en'],
      outDir: '/tmp/out',
    });
  });

  it('routes only matching job events to the handler', async () => {
    invokeMock.mockResolvedValue('job-9');
    const holder: { handler: ((e: { payload: unknown }) => void) | null } = { handler: null };
    listenMock.mockImplementation((_ev: string, h: (e: { payload: unknown }) => void) => {
      holder.handler = h;
      return Promise.resolve(() => {});
    });
    const seen: string[] = [];
    await startDesktopDownload(
      { url: 'u', container: 'video', quality: '720', audioTrack: 'en', captions: [] },
      '/tmp',
      (e) => seen.push(e.status),
    );
    holder.handler?.({ payload: { job_id: 'other', status: 'downloading', percent: 1 } });
    holder.handler?.({ payload: { job_id: 'job-9', status: 'downloading', percent: 50 } });
    expect(seen).toEqual(['downloading']);
    expect(invokeMock).toHaveBeenCalledWith(
      'start_download',
      expect.objectContaining({ audioTrack: 'en', container: 'mp4' }),
    );
  });

  it('cancels by job id and picks folders', async () => {
    invokeMock.mockResolvedValue(undefined);
    openMock.mockResolvedValue('/tmp/picked');
    await cancelDesktopDownload('job-9');
    expect(invokeMock).toHaveBeenCalledWith('cancel_download', { jobId: 'job-9' });
    await expect(pickFolder()).resolves.toBe('/tmp/picked');
  });

  it('names inspect failures per platform', async () => {
    const { inspectFailedMessage } = await import('./desktop');
    expect(inspectFailedMessage(true)).toBe('Could not inspect this video. Check the link and retry.');
    expect(inspectFailedMessage(false)).toContain('backend');
  });
});

describe('resolveOutDir', () => {
  const backing = new Map<string, string>();
  beforeEach(() => {
    backing.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => { backing.set(k, v); },
      removeItem: (k: string) => { backing.delete(k); },
      clear: () => backing.clear(),
    });
  });

  it('reuses the cached folder without prompting', async () => {
    localStorage.setItem('koutube-outdir', '/tmp/keep');
    const { resolveOutDir } = await import('./desktop');
    await expect(resolveOutDir()).resolves.toBe('/tmp/keep');
    expect(openMock).not.toHaveBeenCalled();
  });

  it('picker rejection becomes a loud error, not silence', async () => {
    openMock.mockRejectedValue(new Error('denied'));
    const { resolveOutDir } = await import('./desktop');
    await expect(resolveOutDir()).rejects.toThrow(/folder picker failed: denied/);
  });

  it('cancelled picker becomes a loud error, not silence', async () => {
    openMock.mockResolvedValue(null);
    const { resolveOutDir } = await import('./desktop');
    await expect(resolveOutDir()).rejects.toThrow(/No folder selected/);
  });
});
