import { test, expect } from '@playwright/test';
import { KouTubePage } from '../utils/pom';
import manualOnly from '../fixtures/resolve-manual-only.json' with { type: 'json' };

const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

test.describe('captions (manual-only)', () => {
  test('manual tracks listed with badge', async ({ page }) => {
    await page.route('**/api/resolve', (r) => r.fulfill({ json: manualOnly }));
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await expect(page.getByLabel('Caption en - English')).toBeVisible();
    await expect(page.getByLabel('Caption es - Spanish')).toBeVisible();
    await expect(page.getByText('Manual-only').first()).toBeVisible();
  });

  test('auto captions never surface', async ({ page }) => {
    await page.route('**/api/resolve', (r) => r.fulfill({ json: manualOnly }));
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    // Fixture automatic_captions.en must be ignored: only 2 caption checkboxes.
    await expect(page.getByRole('group', { name: /captions/i }).getByRole('checkbox')).toHaveCount(2);
    await expect(page.getByText(/auto-generated/i)).toHaveCount(0);
  });

  test('prepare carries embedCaptions', async ({ page }) => {
    await page.route('**/api/resolve', (r) => r.fulfill({ json: manualOnly }));
    let posted: Record<string, unknown> | undefined;
    await page.route('**/api/prepare', (r) => {
      posted = r.request().postDataJSON() as Record<string, unknown>;
      return r.fulfill({
        json: {
          filename: 'cap.mp4', container: 'mp4', mergeRequired: true,
          sizeEstimate: 4, streamToken: 's', muxToken: 'm', captions: ['en', 'es'],
        },
      });
    });
    await page.route('**/api/mux*', (r) =>
      r.fulfill({ status: 200, body: 'x', contentType: 'video/mp4' }),
    );
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await app.pickCaptions('en - English', 'es - Spanish');
    await app.download();
    expect(posted).toMatchObject({ embedCaptions: expect.arrayContaining(['en', 'es']) });
  });

  test('empty state when no captions', async ({ page }) => {
    await page.route('**/api/resolve', (r) =>
      r.fulfill({ json: { ...manualOnly, manualCaptions: [] } }),
    );
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await expect(page.getByText('No manual captions for this video.')).toBeVisible();
  });
});
