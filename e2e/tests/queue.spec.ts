import { test, expect } from '@playwright/test';
import { KouTubePage } from '../utils/pom';
import manualOnly from '../fixtures/resolve-manual-only.json' with { type: 'json' };

const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

test.describe('queue management', () => {
  test('remove button drops the card', async ({ page }) => {
    await page.route('**/api/resolve', (r) => r.fulfill({ json: manualOnly }));
    await page.route('**/api/prepare', (r) =>
      r.fulfill({
        json: {
          filename: 'r.mp4', container: 'mp4', mergeRequired: false,
          sizeEstimate: 4, streamToken: 's', muxToken: null, captions: [],
        },
      }),
    );
    await page.route('**/api/stream*', (r) =>
      r.fulfill({ status: 200, body: 'data', contentType: 'video/mp4' }),
    );
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await app.download();
    await expect(page.getByText('saved ✓')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /remove r\.mp4/i }).click();
    await expect(page.getByText('saved ✓')).toHaveCount(0);
    await expect(page.getByText('Nothing here yet.')).toBeVisible();
  });

  test('clear finished drops terminal cards', async ({ page }) => {
    await page.route('**/api/resolve', (r) => r.fulfill({ json: manualOnly }));
    await page.route('**/api/prepare', (r) =>
      r.fulfill({
        json: {
          filename: 'c.mp4', container: 'mp4', mergeRequired: false,
          sizeEstimate: 4, streamToken: 's', muxToken: null, captions: [],
        },
      }),
    );
    await page.route('**/api/stream*', (r) =>
      r.fulfill({ status: 200, body: 'data', contentType: 'video/mp4' }),
    );
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await app.download();
    await expect(page.getByText('saved ✓')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Clear finished' }).click();
    await expect(page.getByText('Nothing here yet.')).toBeVisible();
  });
});

test.describe('settings tab', () => {
  test('navigates, toggles split, picks swatch', async ({ page }) => {
    const app = new KouTubePage(page);
    await app.goto();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Downloads' })).toBeVisible();
    const split = page.getByRole('checkbox', { name: /separate audio/i });
    await split.click();
    await expect(split).toBeChecked();
    await page.getByRole('button', { name: /theme color berry/i }).click();
    const primary = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
    );
    expect(primary.toLowerCase()).toBe('#984061');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await expect(page.getByLabel('YouTube URL')).toBeVisible();
  });
});
