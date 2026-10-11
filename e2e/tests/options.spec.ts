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
    // Inspect auto-selects the original track (en); adding es makes two.
    await app.pickAudioTrack('es');
    await app.download();
    await expect(page.getByText(/Merging to MKV/)).toBeVisible({ timeout: 15_000 });
  });

  test('multi-track audio downloads one file per language', async ({ page }) => {
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
    const posted: unknown[] = [];
    await page.route('**/api/prepare', (r) => {
      posted.push(r.request().postDataJSON());
      return r.fulfill({
        json: {
          filename: 'song.mp3', container: 'mp3', mergeRequired: false,
          sizeEstimate: 4, streamToken: 's', muxToken: null, captions: [],
        },
      });
    });
    await page.route('**/api/stream*', (r) =>
      r.fulfill({ status: 200, body: 'data', contentType: 'audio/mpeg' }),
    );
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await app.pickFormat('audio');
    // en is auto-selected as original; adding es makes two tracks.
    await app.pickAudioTrack('es');
    await app.download();
    await expect(page.getByText('saved ✓').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('saved ✓')).toHaveCount(2);
    const langs = (posted as Array<{ audioTrackLang?: string }>).map((p) => p.audioTrackLang).sort();
    expect(langs).toEqual(['en', 'es']);
    await expect(page.getByText(/\[en\]\.mp3/)).toBeVisible();
    await expect(page.getByText(/\[es\]\.mp3/)).toBeVisible();
  });

  test('audio mode strips captions from prepare', async ({ page }) => {
    await page.route('**/api/resolve', (r) => r.fulfill({ json: manualOnly }));
    let posted: Record<string, unknown> | undefined;
    await page.route('**/api/prepare', (r) => {
      posted = r.request().postDataJSON() as Record<string, unknown>;
      return r.fulfill({
        json: {
          filename: 'a.mp3', container: 'mp3', mergeRequired: false,
          sizeEstimate: 4, streamToken: 's', muxToken: null, captions: [],
        },
      });
    });
    await page.route('**/api/stream*', (r) =>
      r.fulfill({ status: 200, body: 'data', contentType: 'audio/mpeg' }),
    );
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    // Select captions in video mode, then switch: the picker hides in audio
    // mode and the stale selection must not leak into prepare.
    await app.pickCaptions('en - English');
    await app.pickFormat('audio');
    await expect(page.locator('[aria-labelledby="md-captions"]')).toHaveCount(0);
    await app.download();
    await expect(page.getByText('saved ✓')).toBeVisible({ timeout: 15_000 });
    expect(posted).toMatchObject({ embedCaptions: [] });
    await expect(page.getByText(/Audio only — no captions/)).toBeVisible();
  });

  test('web audio hides encode selects and stays MP3', async ({ page }) => {
    await page.route('**/api/resolve', (r) => r.fulfill({ json: manualOnly }));
    let posted: Record<string, unknown> | undefined;
    await page.route('**/api/prepare', (r) => {
      posted = r.request().postDataJSON() as Record<string, unknown>;
      return r.fulfill({
        json: {
          filename: 'a.mp3', container: 'mp3', mergeRequired: false,
          sizeEstimate: 4, streamToken: 's', muxToken: null, captions: [],
        },
      });
    });
    await page.route('**/api/stream*', (r) =>
      r.fulfill({ status: 200, body: 'data', contentType: 'audio/mpeg' }),
    );
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await app.pickFormat('audio');
    // Encode selects are desktop-only; web relays MP3.
    await expect(page.getByLabel('Audio container')).toHaveCount(0);
    await expect(page.getByLabel('Audio codec')).toHaveCount(0);
    await expect(page.getByLabel('Audio quality')).toHaveCount(0);
    await expect(page.getByText(/Audio downloads as MP3 on web/)).toBeVisible();
    await app.download();
    await expect(page.getByText('saved ✓')).toBeVisible({ timeout: 15_000 });
    expect(posted).toMatchObject({ container: 'mp3' });
  });

  test('missing dub fails loudly with the language named', async ({ page }) => {
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
    await page.route('**/api/prepare', (r) => {
      const body = r.request().postDataJSON() as { audioTrackLang?: string };
      if (body.audioTrackLang === 'es') {
        return r.fulfill({ status: 400, json: { detail: { code: 'no-formats', message: "No downloadable formats for these choices. no audio for language 'es'" } } });
      }
      return r.fulfill({
        json: {
          filename: 'song.mp3', container: 'mp3', mergeRequired: false,
          sizeEstimate: 4, streamToken: 's', muxToken: null, captions: [],
        },
      });
    });
    await page.route('**/api/stream*', (r) =>
      r.fulfill({ status: 200, body: 'data', contentType: 'audio/mpeg' }),
    );
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await app.pickFormat('audio');
    await app.pickAudioTrack('es');
    await app.download();
    // en still completes; es fails with the language named — one failure
    // never aborts the rest.
    await expect(page.getByText('saved ✓')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.job', { hasText: "no audio for language 'es'" })).toBeVisible();
  });

  test('batch enqueues all tracks upfront', async ({ page }) => {
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
          filename: 'song.mp3', container: 'mp3', mergeRequired: false,
          sizeEstimate: 4, streamToken: 's', muxToken: null, captions: [],
        },
      }),
    );
    await page.route('**/api/stream*', async (r) => {
      await new Promise((s) => setTimeout(s, 800));
      return r.fulfill({ status: 200, body: 'data', contentType: 'audio/mpeg' });
    });
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(URL);
    await app.pickFormat('audio');
    await app.pickAudioTrack('es');
    await app.download();
    // Both cards exist while the first is still fetching — nothing trickles in.
    await expect(page.locator('.job')).toHaveCount(2);
    await expect(page.getByText('saved ✓')).toHaveCount(2, { timeout: 15_000 });
  });
});
