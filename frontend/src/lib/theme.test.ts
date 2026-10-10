import { describe, expect, it } from 'vitest';
import { resolveTheme } from './store';
import { avatarThumb } from '../components/VideoInfoCard';

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
});
