import { test, expect } from '@playwright/test';
import { KouTubePage } from '../utils/pom';
import manualOnly from '../fixtures/resolve-manual-only.json';

const VALID = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const SHORTS = 'https://www.youtube.com/shorts/dQw4w9WgXcQ';
const PLAYLIST = 'https://www.youtube.com/playlist?list=PL123';

test.describe('resolve', () => {
  test('valid URL shows title', async ({ page }) => {
    await page.route('**/api/resolve', (r) =>
      r.fulfill({ json: manualOnly }),
    );
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(VALID);
    await expect(page.getByRole('heading', { name: 'Manual captions fixture' })).toBeVisible();
  });

  test('invalid URL shows validation error, no fetch', async ({ page }) => {
    let called = false;
    await page.route('**/api/resolve', (r) => {
      called = true;
      return r.fulfill({ json: manualOnly });
    });
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl('not-a-url');
    await expect(page.getByRole('alert').first()).toContainText(/Only YouTube URLs|Invalid URL/);
    expect(called).toBe(false);
  });

  test('Shorts URL resolves', async ({ page }) => {
    await page.route('**/api/resolve', (r) =>
      r.fulfill({ json: { ...manualOnly, title: 'Shorts clip' } }),
    );
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(SHORTS);
    await expect(page.getByRole('heading', { name: 'Shorts clip' })).toBeVisible();
  });

  test('playlist expands entries', async ({ page }) => {
    await page.route('**/api/resolve', (r) =>
      r.fulfill({
        json: {
          ...manualOnly,
          title: 'Playlist',
          isPlaylist: true,
          playlistCount: 3,
        },
      }),
    );
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(PLAYLIST);
    await expect(page.getByText(/playlist 3/i)).toBeVisible();
  });
});
