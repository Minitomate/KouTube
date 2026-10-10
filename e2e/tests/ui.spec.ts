import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { KouTubePage } from '../utils/pom';
import manualOnly from '../fixtures/resolve-manual-only.json' with { type: 'json' };

const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

test.describe('inspect + options UI', () => {
  test('skeleton shows while resolving, then info card', async ({ page }) => {
    await page.route('**/api/resolve', async (r) => {
      await new Promise((s) => setTimeout(s, 400));
      await r.fulfill({ json: manualOnly });
    });
    const app = new KouTubePage(page);
    await app.goto();
    await app.pasteUrl(URL);
    const inspect = app.inspect();
    await expect(page.getByRole('status', { name: 'Loading video details' })).toBeVisible();
    await inspect;
    await expect(page.getByRole('heading', { name: 'Manual captions fixture' })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Loading video details' })).toHaveCount(0);
  });

  test('re-inspect replaces stale card with skeleton', async ({ page }) => {
    let first = true;
    await page.route('**/api/resolve', async (r) => {
      if (!first) await new Promise((s) => setTimeout(s, 400));
      first = false;
      await r.fulfill({ json: manualOnly });
    });
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await expect(page.getByRole('heading', { name: 'Manual captions fixture' })).toBeVisible();
    await app.pasteUrl('https://www.youtube.com/watch?v=9bZkp7q19f0');
    const inspect = app.inspect();
    await expect(page.getByRole('status', { name: 'Loading video details' })).toBeVisible();
    await inspect;
  });

  test('no axe violations after inspect', async ({ page }) => {
    await page.route('**/api/resolve', (r) => r.fulfill({ json: manualOnly }));
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('images mount after idle behind skeletons', async ({ page }) => {
    await page.route('**/api/resolve', (r) => r.fulfill({ json: manualOnly }));
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    // Text paints first; imagery follows once the browser is idle.
    await expect(page.getByRole('heading', { name: 'Manual captions fixture' })).toBeVisible();
    await expect(page.locator('.thumb-wrap img')).toHaveCount(1, { timeout: 10_000 });
  });

  test('info card visual snapshot', async ({ page }) => {
    await page.route('**/api/resolve', (r) => r.fulfill({ json: manualOnly }));
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    const card = page.locator('.inspect-grid > div').first();
    await expect(card).toBeVisible();
    await expect(card).toHaveScreenshot('info-card.png', {
      mask: [page.locator('.thumb-wrap img'), page.locator('.avatar')],
      maxDiffPixels: 200,
    });
  });

  test('slow trickle still completes with advancing progress', async ({ page }) => {
    await page.route('**/api/resolve', (r) => r.fulfill({ json: manualOnly }));
    await page.route('**/api/prepare', (r) =>
      r.fulfill({
        json: {
          filename: 'trickle.mp4', container: 'mp4', mergeRequired: false,
          sizeEstimate: 9, streamToken: 's', muxToken: null, captions: [],
        },
      }),
    );
    // 3 chunks spaced out: progress must advance, watchdog must not fire.
    await page.route('**/api/stream*', async (r) => {
      await new Promise((s) => setTimeout(s, 400));
      await r.fulfill({ status: 200, body: '123456789', contentType: 'video/mp4' });
    });
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await app.download();
    await expect(page.getByText('saved ✓')).toBeVisible({ timeout: 15_000 });
  });
});
