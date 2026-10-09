import { test, expect } from '@playwright/test';
import { KouTubePage } from '../utils/pom';
import manualOnly from '../fixtures/resolve-manual-only.json';

const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

test.describe('captions (manual-only)', () => {
  test('manual tracks listed with badge', async ({ page }) => {
    await page.route('**/api/resolve', (r) => r.fulfill({ json: manualOnly }));
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await expect(page.getByLabel('Caption English')).toBeVisible();
    await expect(page.getByLabel('Caption Spanish')).toBeVisible();
    await expect(page.getByText('Manual-only').first()).toBeVisible();
  });

  test('auto captions never surface', async ({ page }) => {
    await page.route('**/api/resolve', (r) => r.fulfill({ json: manualOnly }));
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    // Fixture raw.automatic_captions.en must be ignored: only 2 caption buttons.
    await expect(page.getByRole('group', { name: 'Captions' }).getByRole('button')).toHaveCount(2);
    await expect(page.getByText(/auto-generated/i)).toHaveCount(0);
  });

  test('embed + srt sidecar payload', async ({ page }) => {
    await page.route('**/api/resolve', (r) => r.fulfill({ json: manualOnly }));
    let posted: Record<string, unknown> | undefined;
    await page.route('**/api/download', (r) => {
      posted = r.request().postDataJSON() as Record<string, unknown>;
      return r.fulfill({ json: { job_id: 'job-cap' } });
    });
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await app.pickCaptions('English', 'Spanish');
    await app.download();
    expect(posted).toMatchObject({ captions: expect.arrayContaining(['en', 'es']) });
  });

  test('empty state when no captions', async ({ page }) => {
    await page.route('**/api/resolve', (r) =>
      r.fulfill({ json: { ...manualOnly, captions: [] } }),
    );
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await expect(page.getByText('No captions available for this video.')).toBeVisible();
  });
});
