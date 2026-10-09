import { test, expect, type Page } from '@playwright/test';
import { KouTubePage } from '../utils/pom';
import manualOnly from '../fixtures/resolve-manual-only.json' with { type: 'json' };

const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

async function mockResolve(page: Page) {
  await page.route('**/api/resolve', (r) => r.fulfill({ json: manualOnly }));
}

function mockPrepare(page: Page, onPost?: (body: Record<string, unknown>) => void) {
  return page.route('**/api/prepare', (r) => {
    const body = r.request().postDataJSON() as Record<string, unknown>;
    onPost?.(body);
    return r.fulfill({
      json: {
        filename: 'Manual captions fixture [dQw4w9WgXcQ].mp4',
        container: 'mp4',
        mergeRequired: false,
        sizeEstimate: 12,
        streamToken: 'stream-test-token',
        muxToken: null,
        captions: ['en', 'es'],
      },
    });
  });
}

async function mockStream(page: Page, bytes = 'hello-koutube') {
  await page.route('**/api/stream*', (r) =>
    r.fulfill({ status: 200, body: bytes, contentType: 'video/mp4' }),
  );
}

test.describe('download (user-end)', () => {
  test('720p mp4 prepares then saves', async ({ page }) => {
    await mockResolve(page);
    let posted: Record<string, unknown> | undefined;
    await mockPrepare(page, (b) => { posted = b; });
    await mockStream(page);
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await app.pickFormat('video');
    await app.pickQuality('720');
    await app.download();
    await expect(page.getByRole('progressbar')).toBeVisible();
    await expect(page.getByText('saved ✓')).toBeVisible();
    expect(posted).toMatchObject({ quality: '720', container: 'mp4' });
  });

  test('mp3-only audio request', async ({ page }) => {
    await mockResolve(page);
    let posted: Record<string, unknown> | undefined;
    await mockPrepare(page, (b) => { posted = b; });
    await mockStream(page);
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await app.pickFormat('audio');
    await app.download();
    await expect(page.getByText('saved ✓')).toBeVisible();
    expect(posted).toMatchObject({ container: 'mp3', quality: 'best' });
  });

  test('merge path uses mux URL', async ({ page }) => {
    await mockResolve(page);
    await page.route('**/api/prepare', (r) =>
      r.fulfill({
        json: {
          filename: 'merge.mp4',
          container: 'mp4',
          mergeRequired: true,
          sizeEstimate: 12,
          streamToken: 's',
          muxToken: 'mux-test-token',
          captions: [],
        },
      }),
    );
    const muxHit: string[] = [];
    await page.route('**/api/mux*', (r) => {
      muxHit.push(r.request().url());
      return r.fulfill({ status: 200, body: 'muxed-bytes!', contentType: 'video/mp4' });
    });
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await app.pickFormat('video');
    await app.pickQuality('best');
    await app.download();
    await expect(page.getByText('saved ✓')).toBeVisible();
    expect(muxHit.length).toBe(1);
    expect(muxHit[0]).toContain('token=mux-test-token');
  });
});
