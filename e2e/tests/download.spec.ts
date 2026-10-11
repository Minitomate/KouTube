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

  test('card shows kind badge and Downloading state', async ({ page }) => {
    await mockResolve(page);
    await mockPrepare(page);
    await page.route('**/api/stream*', async (r) => {
      await new Promise((s) => setTimeout(s, 800));
      return r.fulfill({ status: 200, body: 'hello-koutube', contentType: 'video/mp4' });
    });
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await app.pickFormat('video');
    await app.pickQuality('720');
    await app.download();
    await expect(page.getByLabel('Download type Video · 720p · mp4')).toBeVisible();
    await expect(page.getByText('Downloading', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('saved ✓')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('Download type Video · 720p · mp4')).toBeVisible();
  });

  test('unknown total shows indeterminate busy bar', async ({ page }) => {
    await mockResolve(page);
    await page.route('**/api/prepare', (r) =>
      r.fulfill({
        json: {
          filename: 'u.mp4', container: 'mp4', mergeRequired: false,
          sizeEstimate: null, streamToken: 's', muxToken: null, captions: [],
        },
      }),
    );
    await page.route('**/api/stream*', async (r) => {
      await new Promise((s) => setTimeout(s, 800));
      return r.fulfill({ status: 200, body: 'hello-koutube', contentType: 'video/mp4' });
    });
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await app.download();
    const bar = page.getByRole('progressbar');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveClass(/indeterminate/);
    expect(await bar.getAttribute('aria-valuenow')).toBeNull();
    await expect(page.getByText('Downloading', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('saved ✓')).toBeVisible({ timeout: 15_000 });
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

test.describe('stall recovery (user-end)', () => {
  test('truncated stream surfaces error, never hangs', async ({ page }) => {
    await mockResolve(page);
    await mockPrepare(page);
    // Declares 100 bytes via content-range but always delivers 5, then EOF.
    await page.route('**/api/stream*', (r) =>
      r.fulfill({
        status: 206,
        headers: { 'content-range': 'bytes 0-4/100', 'content-type': 'video/mp4' },
        body: 'short',
      }),
    );
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await app.download();
    await expect(page.getByText(/incomplete/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('short read resumes with Range header', async ({ page }) => {
    await mockResolve(page);
    await mockPrepare(page);
    const ranges: (string | null)[] = [];
    await page.route('**/api/stream*', (r) => {
      ranges.push(r.request().headers()['range'] ?? null);
      // Always delivers the same 5 bytes: resume appends 5+5=10=total → saved.
      return r.fulfill({
        status: 206,
        headers: { 'content-range': 'bytes 0-4/10', 'content-type': 'video/mp4' },
        body: 'short',
      });
    });
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await app.download();
    await expect(page.getByText('saved ✓')).toBeVisible({ timeout: 15_000 });
    // [total probe bytes=0-0, full bytes=0-, resume bytes=5-]
    expect(ranges.length).toBeGreaterThan(2);
    expect(ranges[0]).toBe('bytes=0-0');
    expect(ranges[1]).toBe('bytes=0-');
    expect(ranges[2]).toBe('bytes=5-');
  });
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
      // The pre-flight total probe (Range bytes=0-0) also hits this route;
      // only the real transfer (bytes=0-) counts, not progress polls (rid=).
      if (r.request().url().includes('token=')
        && (r.request().headers()['range'] ?? '') !== 'bytes=0-0') {
        muxHit.push(r.request().url());
      }
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

  test('overrun past estimate completes via Processing', async ({ page }) => {
    await mockResolve(page);
    await page.route('**/api/prepare', (r) =>
      r.fulfill({
        json: {
          filename: 'over.mp4', container: 'mp4', mergeRequired: false,
          sizeEstimate: 5, streamToken: 's', muxToken: null, captions: [],
        },
      }),
    );
    // Delivers 10 bytes against a 5-byte estimate: must complete (honest
    // Processing state), never pin at a frozen 100%.
    await page.route('**/api/stream*', (r) =>
      r.fulfill({ status: 200, body: '0123456789', contentType: 'video/mp4' }),
    );
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await app.download();
    await expect(page.getByText('saved ✓')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  test('staging numbers surface rate and ETA', async ({ page }) => {
    await mockResolve(page);
    await page.route('**/api/prepare', (r) =>
      r.fulfill({
        json: {
          filename: 'stage.mp4', container: 'mp4', mergeRequired: true,
          sizeEstimate: 200, streamToken: 's', muxToken: 'm', captions: [],
        },
      }),
    );
    // NOTE: **/api/mux* is registered first: it also matches the progress
    // path, and last-registered wins, so mux-progress must come last.
    // First byte delayed so the poller fires.
    await page.route('**/api/mux*', async (r) => {
      await new Promise((s) => setTimeout(s, 2500));
      await r.fulfill({ status: 200, body: 'x', contentType: 'video/mp4' });
    });
    await page.route('**/api/mux-progress*', (r) =>
      r.fulfill({
        json: { phase: 'staging-video', loaded: 100, total: 200,
                rate: 8388608, eta: 75 },
      }),
    );
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await app.pickQuality('best');
    await app.download();
    await expect(page.getByText(/8\.0 MB\/s/).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/1m 15s/).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('saved ✓')).toBeVisible({ timeout: 15_000 });
  });
});
