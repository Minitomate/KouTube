import { test, expect } from '@playwright/test';
import { KouTubePage } from '../utils/pom';
import manualOnly from '../fixtures/resolve-manual-only.json' with { type: 'json' };

const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

test.describe('offline behavior', () => {
  test('banner blocks downloads when offline', async ({ page, context }) => {
    await page.route('**/api/resolve', (r) => r.fulfill({ json: manualOnly }));
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await context.setOffline(true);
    // Probe fails (no route for generate_204) → offline banner appears.
    await expect(page.getByText("You're offline.")).toBeVisible({ timeout: 15_000 });
    let prepared = false;
    await page.route('**/api/prepare', (r) => {
      prepared = true;
      return r.fulfill({ json: {} });
    });
    await app.download();
    expect(prepared).toBe(false);
    await expect(page.getByText(/offline/i).first()).toBeVisible();
    await context.setOffline(false);
  });
});

test.describe('container and codec options', () => {
  test('selects container and codec, shows fallback note', async ({ page }) => {
    await page.route('**/api/resolve', (r) => r.fulfill({ json: manualOnly }));
    let posted: Record<string, unknown> | undefined;
    await page.route('**/api/prepare', (r) => {
      posted = r.request().postDataJSON() as Record<string, unknown>;
      return r.fulfill({
        json: {
          filename: 'c.mp4', container: 'mkv', mergeRequired: false,
          sizeEstimate: 4, streamToken: 's', muxToken: null, captions: [],
        },
      });
    });
    await page.route('**/api/stream*', (r) =>
      r.fulfill({ status: 200, body: 'data', contentType: 'video/mp4' }),
    );
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await page.getByLabel('Container').selectOption('mkv');
    await page.getByLabel('Codec').selectOption('avc');
    await app.download();
    await expect(page.getByText('saved ✓')).toBeVisible({ timeout: 15_000 });
    expect(posted).toMatchObject({ container: 'mkv', codec: 'avc' });
  });

  test('multi-audio in mp4 warns about MKV switch', async ({ page }) => {
    await page.route('**/api/resolve', (r) =>
      r.fulfill({
        json: {
          ...manualOnly,
          audioTracks: [
            { lang: 'en', label: 'English (en)' },
            { lang: 'es', label: 'Spanish (es)' },
          ],
        },
      }),
    );
    await page.route('**/api/prepare', (r) =>
      r.fulfill({
        json: {
          filename: 'm.mkv', container: 'mkv', mergeRequired: false,
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
    await app.pickAudioTrack('en');
    await app.pickAudioTrack('es');
    await app.download();
    await expect(page.getByText(/Merging to MKV/)).toBeVisible({ timeout: 15_000 });
  });
});
