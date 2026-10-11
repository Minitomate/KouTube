import { describe, expect, it } from 'vitest';
import { planParts, PART_BYTES, fmtBytes, kindBadge, statusLine } from './transfer';

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
