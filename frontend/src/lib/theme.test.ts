import { describe, expect, it } from 'vitest';
import { resolveTheme } from './store';
import { avatarThumb, fmtRelative } from '../components/VideoInfoCard';

describe('resolveTheme', () => {
  it('honors explicit choices', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the OS in auto mode', () => {
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
  });
});

describe('fmtRelative', () => {
  const now = 1_700_000_000_000;
  it('renders minutes, hours, days, months, years', () => {
    expect(fmtRelative(now / 1000 - 120, now)).toBe('2 minutes ago');
    expect(fmtRelative(now / 1000 - 2 * 3600, now)).toBe('2 hours ago');
    expect(fmtRelative(now / 1000 - 3600, now)).toBe('1 hour ago');
    expect(fmtRelative(now / 1000 - 3 * 86400, now)).toBe('3 days ago');
    expect(fmtRelative(now / 1000 - 60 * 86400, now)).toBe('2 months ago');
    expect(fmtRelative(now / 1000 - 400 * 86400, now)).toBe('1 year ago');
  });

  it('returns empty without a timestamp', () => {
    expect(fmtRelative(undefined, now)).toBe('');
  });
});

describe('effectiveQuality', () => {
  it('computes nearest quality carrying the codec', async () => {
    const { effectiveQuality, vcodecMatches } = await import('./store');
    expect(vcodecMatches('avc1.640028', 'avc')).toBe(true);
    expect(vcodecMatches('vp09.00.50.08', 'avc')).toBe(false);
    expect(vcodecMatches('hev1.1.6', 'hevc')).toBe(true);
    expect(vcodecMatches('hvc1.1.6', 'hevc')).toBe(true);
    expect(vcodecMatches('av01.0.05M.08', 'av1')).toBe(true);
    expect(vcodecMatches(undefined, 'avc')).toBe(false);
    const formats = [
      { height: 720, vcodec: 'avc1.4D401F' },
      { height: 1080, vcodec: 'vp09.00.40.08' },
      { height: 2160, vcodec: 'av01.0.13M.08' },
    ];
    expect(effectiveQuality(formats, 'best', 'auto')).toEqual({ quality: 'best', note: null });
    expect(effectiveQuality(formats, '2160', 'avc')).toEqual({
      quality: '720', note: 'AVC (H.264) best available: 720p',
    });
    expect(effectiveQuality(formats, '720', 'avc')).toEqual({ quality: '720', note: null });
  });
});

describe('avatarThumb', () => {
  it('requests the small variant', () => {
    expect(avatarThumb('https://x.googleusercontent.com/a=s0')).toBe(
      'https://x.googleusercontent.com/a=s88',
    );
    expect(avatarThumb('https://x.googleusercontent.com/a=s176-c-k')).toBe(
      'https://x.googleusercontent.com/a=s88',
    );
  });

  it('passes through unknown shapes and missing urls', () => {
    expect(avatarThumb(undefined)).toBeUndefined();
    expect(avatarThumb('https://example.com/a.png')).toBe('https://example.com/a.png');
  });

  it('appends sizing to parameterless google images', () => {
    expect(avatarThumb('https://yt3.googleusercontent.com/abc123')).toBe(
      'https://yt3.googleusercontent.com/abc123=s88',
    );
  });
});
