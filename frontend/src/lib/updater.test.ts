import { describe, expect, it } from 'vitest';
import { shouldAutoCheck, checkForUpdate, formatReleaseDate, UPDATE_CHECK_INTERVAL_MS } from './updater';

describe('update check gate', () => {
  it('never checks when the toggle is off', () => {
    expect(shouldAutoCheck(false, null)).toBe(false);
    expect(shouldAutoCheck(false, Date.now() - 10 * UPDATE_CHECK_INTERVAL_MS)).toBe(false);
  });

  it('checks when never checked before', () => {
    expect(shouldAutoCheck(true, null)).toBe(true);
  });

  it('checks at most once per 24h', () => {
    const now = Date.now();
    expect(shouldAutoCheck(true, now, now)).toBe(false);
    expect(shouldAutoCheck(true, now - UPDATE_CHECK_INTERVAL_MS + 1000, now)).toBe(false);
    expect(shouldAutoCheck(true, now - UPDATE_CHECK_INTERVAL_MS, now)).toBe(true);
    expect(shouldAutoCheck(true, now - 2 * UPDATE_CHECK_INTERVAL_MS, now)).toBe(true);
  });

  it('returns null off-desktop without throwing', async () => {
    await expect(checkForUpdate()).resolves.toBeNull();
  });

  it('formats the release date, ignoring junk', () => {
    expect(formatReleaseDate(null)).toBeNull();
    expect(formatReleaseDate('not-a-date')).toBeNull();
    expect(formatReleaseDate('2026-10-01T12:00:00Z')).toBe(
      new Date('2026-10-01T12:00:00Z').toLocaleDateString(),
    );
  });
});
