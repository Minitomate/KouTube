import { test, expect, type Page } from '@playwright/test';
import { KouTubePage } from '../utils/pom';
import manualOnly from '../fixtures/resolve-manual-only.json' with { type: 'json' };

const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

async function openCaptions(page: Page) {
  await page.locator('[aria-labelledby="md-captions"]').click();
}

test.describe('captions (manual-only dropdown)', () => {
  test('manual tracks listed with badge', async ({ page }) => {
    await page.route('**/api/resolve', (r) => r.fulfill({ json: manualOnly }));
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await expect(page.locator('[aria-labelledby="md-captions"]')).toContainText('None');
    await openCaptions(page);
    await expect(page.getByRole('option', { name: /en - English/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /es - Spanish/ })).toBeVisible();
    await expect(page.getByText('Manual-only').first()).toBeVisible();
  });

  test('auto captions never surface', async ({ page }) => {
    await page.route('**/api/resolve', (r) => r.fulfill({ json: manualOnly }));
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await openCaptions(page);
    // Fixture automatic_captions.en must be ignored: only 2 options.
    await expect(page.getByRole('listbox', { name: 'Captions' }).getByRole('option')).toHaveCount(2);
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
    await openCaptions(page);
    await expect(page.getByText('No manual captions for this video.')).toBeVisible();
  });

  test('keyboard: Enter toggles, Escape closes', async ({ page }) => {
    await page.route('**/api/resolve', (r) => r.fulfill({ json: manualOnly }));
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await openCaptions(page);
    const opt = page.getByRole('option', { name: /en - English/ });
    await opt.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[aria-labelledby="md-captions"]')).toContainText('English');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox', { name: 'Captions' })).toHaveCount(0);
  });
});

test.describe('captions-only mode', () => {
  test('blocked with no language selected', async ({ page }) => {
    await page.route('**/api/resolve', (r) => r.fulfill({ json: manualOnly }));
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await app.pickFormat('captions');
    await app.download();
    await expect(page.getByText(/caption language/i)).toBeVisible();
  });

  test('single language downloads one .srt', async ({ page }) => {
    await page.route('**/api/resolve', (r) => r.fulfill({ json: manualOnly }));
    const langs: string[] = [];
    await page.route('**/api/subs*', (r) => {
      langs.push(/lang=([a-z-]+)/.exec(r.request().url())?.[1] ?? '');
      return r.fulfill({ status: 200, body: '1\n00:00:00,000 --> 00:00:01,000\nhi', contentType: 'text/plain' });
    });
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await app.pickFormat('captions');
    await app.pickCaptions('en - English');
    await app.download();
    await expect(page.getByText('saved ✓')).toBeVisible({ timeout: 15_000 });
    expect(langs).toEqual(['en']);
    await expect(page.getByText(/\[en\]\.srt/)).toBeVisible();
  });

  test('two languages download as zip', async ({ page }) => {
    await page.route('**/api/resolve', (r) => r.fulfill({ json: manualOnly }));
    const langs: string[] = [];
    await page.route('**/api/subs*', (r) => {
      langs.push(/lang=([a-z-]+)/.exec(r.request().url())?.[1] ?? '');
      return r.fulfill({ status: 200, body: '1\n00:00:00,000 --> 00:00:01,000\nhi', contentType: 'text/plain' });
    });
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await app.pickFormat('captions');
    await app.pickCaptions('en - English', 'es - Spanish');
    await app.download();
    await expect(page.getByText('saved ✓').first()).toBeVisible({ timeout: 15_000 });
    expect(langs.sort()).toEqual(['en', 'es']);
  });
});
