import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const listenMock = vi.fn();
const openMock = vi.fn();
const openPathMock = vi.fn();
const revealMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (...args: unknown[]) => openMock(...args),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({
  openPath: (...args: unknown[]) => openPathMock(...args),
  revealItemInDir: (...args: unknown[]) => revealMock(...args),
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
  openPathMock.mockReset();
  revealMock.mockReset();
});

describe('desktop adapter', () => {
  it('maps web choices to Tauri camelCase invoke args', async () => {
    invokeMock.mockResolvedValue('job-1');
    listenMock.mockResolvedValue(() => {});
    await startDesktopDownload(
      { url: 'https://www.youtube.com/watch?v=x', videoId: 'x', kind: 'audio', outputContainer: 'm4a', quality: 'best', codec: 'auto', audioCodec: 'alac', audioQuality: null, captionsFormat: 'srt', audioTracks: ['original'], captions: ['en'], overwrite: false, splitKinds: false },
      '/tmp/out',
      () => {},
    );
    expect(invokeMock).toHaveBeenCalledWith('start_download', {
      url: 'https://www.youtube.com/watch?v=x',
      videoId: 'x',
      container: 'm4a',
      quality: 'best',
      // Tauri exposes snake_case Rust params as camelCase: assert exact keys.
      codec: null,
      audioCodec: 'alac',
      audioQuality: null,
      captionsFormat: 'srt',
      audioTracks: [],
      captions: ['en'],
      captionsOnly: false,
      outDir: '/tmp/out',
      overwrite: false,
      splitKinds: false,
    });
  });

  it('sends captions-only jobs with the srt container flag', async () => {
    invokeMock.mockResolvedValue('job-2');
    listenMock.mockResolvedValue(() => {});
    await startDesktopDownload(
      { url: 'u', videoId: 'v', kind: 'captions', outputContainer: 'srt', quality: 'best', codec: 'auto', audioCodec: 'mp3', audioQuality: null, captionsFormat: 'vtt', audioTracks: [], captions: ['en', 'de'], overwrite: false, splitKinds: true },
      '/tmp',
      () => {},
    );
    expect(invokeMock).toHaveBeenCalledWith('start_download', {
      url: 'u',
      videoId: 'v',
      container: 'srt',
      quality: 'best',
      codec: null,
      audioCodec: null,
      audioQuality: null,
      captionsFormat: 'vtt',
      audioTracks: [],
      captions: ['en', 'de'],
      captionsOnly: true,
      outDir: '/tmp',
      overwrite: false,
      splitKinds: true,
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
      { url: 'u', videoId: 'u', kind: 'video', outputContainer: 'mkv', quality: '720', codec: 'avc', audioCodec: 'mp3', audioQuality: null, captionsFormat: 'srt', audioTracks: ['en', 'de'], captions: [], overwrite: false, splitKinds: false },
      '/tmp',
      (e) => seen.push(e.status),
    );
    holder.handler?.({ payload: { job_id: 'other', status: 'downloading', percent: 1 } });
    holder.handler?.({ payload: { job_id: 'job-9', status: 'downloading', percent: 50 } });
    expect(seen).toEqual(['downloading']);
    expect(invokeMock).toHaveBeenCalledWith(
      'start_download',
      expect.objectContaining({ audioTracks: ['en', 'de'], codec: 'avc', container: 'mkv' }),
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

  it('plays, reveals and trashes by exact path', async () => {
    const { playFile, revealFile, trashDownload } = await import('./desktop');
    invokeMock.mockResolvedValue(undefined);
    openPathMock.mockResolvedValue(undefined);
    revealMock.mockResolvedValue(undefined);
    await playFile('/tmp/v.mp4');
    expect(openPathMock).toHaveBeenCalledWith('/tmp/v.mp4');
    await revealFile('/tmp/v.mp4');
    expect(revealMock).toHaveBeenCalledWith('/tmp/v.mp4');
    await trashDownload('/tmp/v.mp4');
    expect(invokeMock).toHaveBeenCalledWith('trash_file', { path: '/tmp/v.mp4' });
  });

  it('maps sidecar events to card states', async () => {
    const { mapDesktopEvent } = await import('./desktop');
    expect(mapDesktopEvent({ job_id: 'j', status: 'downloading', percent: 42, speed: '1.0MB/s', eta: '00:03' }))
      .toMatchObject({ kind: 'progress', percent: 42, stage: 'fetching' });
    expect(mapDesktopEvent({ job_id: 'j', status: 'merging', percent: 100 }).stage).toBe('finalizing');
    expect(mapDesktopEvent({ job_id: 'j', status: 'retrying', percent: 10 }).stage).toBe('finalizing');
    expect(mapDesktopEvent({ job_id: 'j', status: 'done', percent: 100 }).kind).toBe('done');
    expect(mapDesktopEvent({ job_id: 'j', status: 'error', percent: 0 }).kind).toBe('error');
    expect(mapDesktopEvent({ job_id: 'j', status: 'cancelled', percent: 0 }).kind).toBe('cancelled');
    const noted = mapDesktopEvent({ job_id: 'j', status: 'downloading', percent: 1, speed: '2.0MB/s', eta: '00:01' });
    expect(noted.note).toContain('2.0MB/s');
    expect(noted.note).toContain('ETA 00:01');
  });

  it('computes client %/s over a rolling window', async () => {
    const { pctRate } = await import('./desktop');
    const t0 = 1000000;
    const samples = [
      { t: t0, p: 10 },
      { t: t0 + 1000, p: 12 },
      { t: t0 + 2000, p: 14 },
    ];
    expect(pctRate(samples, t0 + 2000)).toBeCloseTo(2, 5);
    expect(pctRate([{ t: t0, p: 10 }], t0 + 1000)).toBeNull();
    expect(pctRate(samples, t0 + 10000)).toBeNull(); // stale window
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

  it('always prompts (persistence lives in settings)', async () => {
    openMock.mockResolvedValue('/tmp/fresh');
    const { resolveOutDir } = await import('./desktop');
    await expect(resolveOutDir()).resolves.toBe('/tmp/fresh');
    expect(openMock).toHaveBeenCalled();
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
