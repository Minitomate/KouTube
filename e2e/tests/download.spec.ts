import { test, expect, type Page } from '@playwright/test';
import { KouTubePage } from '../utils/pom';
import manualOnly from '../fixtures/resolve-manual-only.json' with { type: 'json' };

const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

async function mockResolve(page: Page) {
  await page.route('**/api/resolve', (r) => r.fulfill({ json: manualOnly }));
}

test.describe('download', () => {
  test('720p mp4 starts a job', async ({ page }) => {
    await mockResolve(page);
    await page.route('**/api/download', (r) => {
      const body = r.request().postDataJSON() as Record<string, unknown>;
      expect(body.quality).toBe('720');
      expect(body.format).toBe('video');
      return r.fulfill({ json: { job_id: 'job-720p' } });
    });
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await app.pickFormat('video');
    await app.pickQuality('720');
    await app.download();
    await expect(page.getByRole('progressbar')).toBeVisible();
  });

  test('mp3-only audio request', async ({ page }) => {
    await mockResolve(page);
    await page.route('**/api/download', (r) => {
      const body = r.request().postDataJSON() as Record<string, unknown>;
      expect(body.format).toBe('audio');
      return r.fulfill({ json: { job_id: 'job-mp3' } });
    });
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await app.pickFormat('audio');
    await app.download();
    await expect(page.getByRole('progressbar')).toBeVisible();
  });

  test('merge: best quality posts video payload', async ({ page }) => {
    await mockResolve(page);
    let posted: Record<string, unknown> | undefined;
    await page.route('**/api/download', (r) => {
      posted = r.request().postDataJSON() as Record<string, unknown>;
      return r.fulfill({ json: { job_id: 'job-merge' } });
    });
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await app.pickFormat('video');
    await app.pickQuality('best');
    await app.download();
    expect(posted).toMatchObject({ format: 'video', quality: 'best' });
  });
});
