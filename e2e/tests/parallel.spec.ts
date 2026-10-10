import { test, expect, type Page } from '@playwright/test';
import { KouTubePage } from '../utils/pom';
import manualOnly from '../fixtures/resolve-manual-only.json' with { type: 'json' };

const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
// 20MB deterministic buffer: 3 parts (8MB + 8MB + 4MB).
const TOTAL = 20 * 1048576;
const expected = new Uint8Array(TOTAL);
for (let i = 0; i < TOTAL; i++) expected[i] = i % 251;
const checksum = (b: Uint8Array) => b.reduce((a, x) => (a + x) % 1000003, 0);
const EXPECTED_SUM = checksum(expected);

function sliceFor(range: string | null): { start: number; body: Buffer } {
  const m = /bytes=(\d+)-(\d+)/.exec(range ?? '');
  const start = m ? Number(m[1]) : 0;
  const end = m ? Number(m[2]) : TOTAL - 1;
  return { start, body: Buffer.from(expected.slice(start, end + 1)) };
}

async function installFakePicker(page: Page) {
  await page.addInitScript(() => {
    const g = window as unknown as {
      showSaveFilePicker: unknown;
      __writes: Array<{ position: number; data: number[] }>;
      __assembledSum: number;
    };
    g.__writes = [];
    g.showSaveFilePicker = async () => ({
      createWritable: async () => ({
        write: async (chunk: unknown) => {
          if (chunk && typeof chunk === 'object' && 'position' in (chunk as object)) {
            const c = chunk as { position: number; data: Uint8Array };
            g.__writes.push({ position: c.position, data: Array.from(c.data) });
          }
        },
        close: async () => {
          const ordered = [...g.__writes].sort((a, b) => a.position - b.position);
          let sum = 0;
          let cursor = 0;
          for (const w of ordered) {
            if (w.position !== cursor) throw new Error('gap/overlap in parts');
            for (const byte of w.data) sum = (sum + byte) % 1000003;
            cursor += w.data.length;
          }
          if (cursor !== 200 * 1048576 / 10) { /* length asserted in test */ }
          g.__assembledSum = sum;
          (g as unknown as { __assembledLen: number }).__assembledLen = cursor;
        },
      }),
    });
  });
}

async function mockResolve(page: Page) {
  await page.route('**/api/resolve', (r) => r.fulfill({ json: manualOnly }));
}

function mockPrepare(page: Page, size = TOTAL) {
  return page.route('**/api/prepare', (r) =>
    r.fulfill({
      json: {
        filename: 'parallel.mp4', container: 'mp4', mergeRequired: false,
        sizeEstimate: size, streamToken: 'tok', muxToken: null, captions: [],
      },
    }),
  );
}

test.describe('parallel parts (user-end)', () => {
  test('out-of-order parts assemble byte-identical with concurrency', async ({ page }) => {
    await installFakePicker(page);
    await mockResolve(page);
    await mockPrepare(page);
    let inFlight = 0;
    let maxFlight = 0;
    await page.route('**/api/stream*', async (r) => {
      inFlight += 1;
      maxFlight = Math.max(maxFlight, inFlight);
      try {
        // Random delay forces out-of-order completion.
        await new Promise((s) => setTimeout(s, Math.random() * 120));
        const { start, body } = sliceFor(r.request().headers()['range'] ?? null);
        return r.fulfill({
          status: 206,
          headers: {
            'content-range': `bytes ${start}-${start + body.length - 1}/${TOTAL}`,
            'content-type': 'video/mp4',
          },
          body,
        });
      } finally {
        inFlight -= 1;
      }
    });
    const app = new KouTubePage(page);
    await page.goto('/?forcefs=1');
    await app.inspectUrl(URL);
    await app.download();
    await expect(page.getByText('saved ✓')).toBeVisible({ timeout: 30_000 });
    expect(maxFlight).toBeGreaterThan(1);
    const sum = await page.evaluate(
      () => (window as unknown as { __assembledSum: number }).__assembledSum,
    );
    const len = await page.evaluate(
      () => (window as unknown as { __assembledLen: number }).__assembledLen,
    );
    expect(len).toBe(TOTAL);
    expect(sum).toBe(EXPECTED_SUM);
  });

  test('direct failure falls back to proxy', async ({ page }) => {
    await mockResolve(page);
    const proxyHits: string[] = [];
    await page.route('https://direct.test/*', (r) =>
      r.fulfill({ status: 403, body: 'denied' }),
    );
    await page.route('**/api/prepare', (r) =>
      r.fulfill({
        json: {
          filename: 'fb.mp4', container: 'mp4', mergeRequired: false,
          sizeEstimate: 12, streamToken: 'tok', muxToken: null, captions: [],
          videoUrl: 'https://direct.test/v',
        },
      }),
    );
    await page.route('**/api/stream*', (r) => {
      proxyHits.push(r.request().url());
      return r.fulfill({ status: 200, body: 'via-proxy!', contentType: 'video/mp4' });
    });
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await app.download();
    await expect(page.getByText('saved ✓')).toBeVisible({ timeout: 15_000 });
    expect(proxyHits.length).toBeGreaterThan(0);
  });

  test('quality picker shows the real ceiling, not 4K', async ({ page }) => {
    await mockResolve(page);
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    // Fixture heights are 480/720/1080: exact 1080p option exists, 4320 does not.
    await expect(page.getByRole('option', { name: '1080p', exact: true })).toHaveCount(1);
    await expect(page.getByRole('option', { name: /4320/ })).toHaveCount(0);
    await expect(page.getByText(/up to 1080p/)).toBeVisible();
  });
});
