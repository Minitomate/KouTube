import { describe, expect, it, vi } from 'vitest';
import { planParts, PART_BYTES, fmtBytes, fmtClock, kindBadge, statusLine, splitStats, throttleLatest, stableETA, makeRateTracker } from './transfer';

describe('planParts', () => {
  it('tiles exactly with a clipped tail', () => {
    const total = 2 * PART_BYTES + 123;
    const parts = planParts(total);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ start: 0, end: PART_BYTES - 1 });
    expect(parts[2]).toEqual({ start: 2 * PART_BYTES, end: total - 1 });
    const covered = parts.reduce((a, p) => a + (p.end - p.start + 1), 0);
    expect(covered).toBe(total);
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i].start).toBe(parts[i - 1].end + 1);
    }
  });

  it('handles exact multiples and tiny files', () => {
    expect(planParts(PART_BYTES)).toEqual([{ start: 0, end: PART_BYTES - 1 }]);
    expect(planParts(1)).toEqual([{ start: 0, end: 0 }]);
  });
});

describe('fmtBytes', () => {
  it('scales B/KB/MB/GB', () => {
    expect(fmtBytes(0)).toBe('0 B');
    expect(fmtBytes(512)).toBe('512 B');
    expect(fmtBytes(2048)).toBe('2 KB');
    expect(fmtBytes(5 * 1048576)).toBe('5.0 MB');
    expect(fmtBytes(2 * 1073741824)).toBe('2.0 GB');
  });
});

describe('kindBadge', () => {
  it('labels kind plus detail', () => {
    expect(kindBadge('video', '720p · mp4')).toBe('Video · 720p · mp4');
    expect(kindBadge('audio', 'es')).toBe('Audio · es');
    expect(kindBadge('captions', 'en')).toBe('Captions · en');
    expect(kindBadge('video')).toBe('Video');
    expect(kindBadge(undefined)).toBeNull();
  });
});

describe('statusLine', () => {
  const base = { status: 'working' as const, stage: 'downloading', loaded: 0, total: null as number | null };
  it('combines stage, bytes, and speed note', () => {
    expect(statusLine(base, null)).toBe('Downloading');
    expect(statusLine({ ...base, loaded: 1024, note: '2.0 MB/s' }, null))
      .toBe('Downloading · 1 KB downloaded · 2.0 MB/s');
    expect(statusLine({ ...base, loaded: 5242880, total: 10485760, note: '1.0 MB/s · 5s left' }, null))
      .toBe('Downloading · 5.0 MB/10.0 MB · 1.0 MB/s · 5s left');
  });

  it('names processing with received bytes and elapsed', () => {
    expect(statusLine({ ...base, stage: 'processing', loaded: 10485760, note: undefined }, '0:42'))
      .toBe('Processing… 10.0 MB received · 0:42');
  });

  it('covers preparing, done, error, cancelled', () => {
    expect(statusLine({ ...base, stage: 'preparing' }, null)).toBe('Preparing…');
    expect(statusLine({ ...base, status: 'done', note: 'subtitles: en' }, null))
      .toBe('Saved ✓ · subtitles: en');
    expect(statusLine({ ...base, status: 'error', error: 'boom' }, null)).toBe('failed: boom');
    expect(statusLine({ ...base, status: 'cancelled' }, null)).toBe('cancelled');
  });
});

describe('throttleLatest', () => {
  it('fires leading immediately, trails latest at 4Hz', () => {
    vi.useFakeTimers();
    try {
      const seen: number[] = [];
      const t = throttleLatest((n: number) => { seen.push(n); }, 250);
      t(1);
      expect(seen).toEqual([1]);
      t(2);
      t(3);
      expect(seen).toEqual([1]);
      vi.advanceTimersByTime(250);
      expect(seen).toEqual([1, 3]);
      vi.advanceTimersByTime(250);
      t(4);
      expect(seen).toEqual([1, 3, 4]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flush emits pending now, cancel drops it', () => {
    vi.useFakeTimers();
    try {
      const seen: number[] = [];
      const t = throttleLatest((n: number) => { seen.push(n); }, 250);
      t(1);
      t(2);
      t.flush();
      expect(seen).toEqual([1, 2]);
      vi.advanceTimersByTime(1000);
      expect(seen).toEqual([1, 2]);
      t(3);
      t(4);
      t.cancel();
      vi.advanceTimersByTime(1000);
      expect(seen).toEqual([1, 2, 3]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('stableETA', () => {
  it('holds through wobble and transient unknowns', () => {
    expect(stableETA(null, null)).toBeNull();
    expect(stableETA(null, 8)).toBe(8);
    expect(stableETA(8, null)).toBe(8);
    expect(stableETA(10, 11)).toBe(10);
    expect(stableETA(10, 20)).toBe(20);
  });

  it('tightens relatively: large ETAs tolerate more swing', () => {
    expect(stableETA(100, 105)).toBe(100); // 5 < 10% band
    expect(stableETA(100, 115)).toBe(115);
    expect(stableETA(8, 9)).toBe(8); // 1 < 2.5s floor
  });
});

describe('makeRateTracker', () => {
  it('blends recent pace with the overall average so ETA converges', () => {
    // performance.now is real-clock: drive it with a spy for determinism.
    let now = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      const seen: Array<[number, number | null]> = [];
      const track = makeRateTracker((bps, eta) => { seen.push([bps, eta]); }, () => 100000);
      track(5000); // t=0: single sample, hold
      expect(seen).toEqual([]);
      now = 2000;
      track(7000); // 1000 B/s steady: recent == overall == 1000
      expect(seen).toHaveLength(1);
      expect(seen[0][0]).toBeCloseTo(1000, 5);
      expect(seen[0][1]).toBeCloseTo(93, 0);
      now = 4000;
      track(7200); // collapse to 100 B/s recent; overall still ~550
      expect(seen).toHaveLength(2);
      expect(seen[1][0]).toBeCloseTo(100, 5); // speed stays recent-only
      const eta = seen[1][1] as number;
      // Blended (325 B/s → ~286s) sits between recent-only (~928s) and
      // overall-only (~169s): anchored, not whiplashed.
      expect(eta).toBeGreaterThan(200);
      expect(eta).toBeLessThan(400);
    } finally {
      spy.mockRestore();
    }
  });
});
describe('splitStats', () => {
  it('splits client rate notes', () => {
    expect(splitStats('2.1 MB/s · 5s left'))
      .toEqual({ speed: '2.1 MB/s', eta: '5s left', rest: null });
    expect(splitStats('850 KB/s')).toEqual({ speed: '850 KB/s', eta: null, rest: null });
  });

  it('splits server staging notes and drops the server prefix', () => {
    expect(splitStats('server: Staging video · 5.0 MB / 10.0 MB · 2.1 MB/s · 1m 3s left'))
      .toEqual({ speed: '2.1 MB/s', eta: '1m 3s left', rest: 'Staging video · 5.0 MB / 10.0 MB' });
    expect(splitStats('server: Merging on server… · 8.0 MB'))
      .toEqual({ speed: null, eta: null, rest: 'Merging on server… · 8.0 MB' });
  });

  it('accepts yt-dlp raw units and keeps foreign notes whole', () => {
    expect(splitStats('2.81MiB/s')).toEqual({ speed: '2.81MiB/s', eta: null, rest: null });
    expect(splitStats('Zipping 45%')).toEqual({ speed: null, eta: null, rest: 'Zipping 45%' });
    expect(splitStats(undefined)).toEqual({ speed: null, eta: null, rest: null });
  });

  it('recognizes sidecar ETA timestamps for the clock chip', () => {
    expect(splitStats('2.81MiB/s · ETA 00:05'))
      .toEqual({ speed: '2.81MiB/s', eta: 'ETA 00:05', rest: null });
    expect(splitStats('ETA 01:02:03')).toEqual({ speed: null, eta: 'ETA 01:02:03', rest: null });
    // Unknown stays visible as remainder text, never as a fake ETA.
    expect(splitStats('2.81MiB/s · ETA Unknown'))
      .toEqual({ speed: '2.81MiB/s', eta: null, rest: 'ETA Unknown' });
  });
});

describe('fmtClock', () => {
  it('pads mm:ss and h:mm:ss', () => {
    expect(fmtClock(5)).toBe('0:05');
    expect(fmtClock(65)).toBe('1:05');
    expect(fmtClock(3665)).toBe('1:01:05');
    expect(fmtClock(NaN)).toBe('');
  });
});
