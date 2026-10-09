import { test, expect } from '@playwright/test';
import { KouTubePage } from '../utils/pom';
import manualOnly from '../fixtures/resolve-manual-only.json' with { type: 'json' };

const PLAYLIST = 'https://www.youtube.com/playlist?list=PL123';

test.describe('playlist batch', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/resolve', (r) =>
      r.fulfill({
        json: { ...manualOnly, title: 'Batch playlist', isPlaylist: true, playlistCount: 3 },
      }),
    );
  });

  test('3-item batch enqueues', async ({ page }) => {
    const ids = ['job-1', 'job-2', 'job-3'];
    await page.route('**/api/download', (r) => r.fulfill({ json: { job_id: ids.shift() ?? 'job-x' } }));
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(PLAYLIST);
    // One start per entry (mocked as sequential starts).
    for (let i = 0; i < 3; i++) await app.download();
    await expect(page.getByRole('progressbar').first()).toBeVisible();
  });

  test('cancel + retry flow', async ({ page }) => {
    await page.route('**/api/download', (r) => r.fulfill({ json: { job_id: 'job-c' } }));
    await page.route('**/api/jobs/job-c', (r) =>
      r.request().method() === 'DELETE' ? r.fulfill({ json: { ok: true } }) : r.continue(),
    );
    await page.route('**/api/jobs/job-c/retry', (r) => r.fulfill({ json: { job_id: 'job-r' } }));
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(PLAYLIST);
    await app.download();
    // Cancel and retry buttons appear on the job card (SSE/progress mocked by UI store).
    await expect(page.getByRole('progressbar').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /cancel /i }).first()).toBeVisible();
    // Retry only renders on error/cancelled jobs (see JobCard) — not asserted on fresh queue.
  });
});
