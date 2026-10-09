import { test, expect } from '@playwright/test';
import { KouTubePage } from '../utils/pom';
import manualOnly from '../fixtures/resolve-manual-only.json' with { type: 'json' };

const PLAYLIST = 'https://www.youtube.com/playlist?list=PL123';

function playlistResolve() {
  return {
    ...manualOnly,
    title: 'Batch playlist',
    is_playlist: true,
    entries: [
      { videoId: 'aaa', title: 'One' },
      { videoId: 'bbb', title: 'Two' },
      { videoId: 'ccc', title: 'Three' },
    ],
  };
}

test.describe('playlist batch (single ZIP, user-end)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/resolve', (r) => r.fulfill({ json: playlistResolve() }));
  });

  test('3-item batch zips', async ({ page }) => {
    await page.route('**/api/prepare', (r) =>
      r.fulfill({
        json: {
          filename: 'item.mp4', container: 'mp4', mergeRequired: false,
          sizeEstimate: 5, streamToken: 'tok', muxToken: null, captions: [],
        },
      }),
    );
    await page.route('**/api/stream*', (r) =>
      r.fulfill({ status: 200, body: 'bytes!', contentType: 'video/mp4' }),
    );
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(PLAYLIST);
    await app.downloadZip();
    await expect(page.getByRole('progressbar').first()).toBeVisible();
    await expect(page.getByText('saved ✓').first()).toBeVisible();
  });

  test('failed item reported, batch continues', async ({ page }) => {
    let n = 0;
    await page.route('**/api/prepare', (r) => {
      n += 1;
      if (n === 2) return r.fulfill({ status: 400, json: { detail: { code: 'x', message: 'nope' } } });
      return r.fulfill({
        json: {
          filename: `item${n}.mp4`, container: 'mp4', mergeRequired: false,
          sizeEstimate: 5, streamToken: 'tok', muxToken: null, captions: [],
        },
      });
    });
    await page.route('**/api/stream*', (r) =>
      r.fulfill({ status: 200, body: 'bytes!', contentType: 'video/mp4' }),
    );
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(PLAYLIST);
    await app.downloadZip();
    await expect(page.getByText(/nope|failed/i).first()).toBeVisible();
  });
});
