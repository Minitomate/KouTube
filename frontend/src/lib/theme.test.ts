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
