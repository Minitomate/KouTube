import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from '@playwright/test';
import { KouTubePage } from '../utils/pom';
import manualOnly from '../fixtures/resolve-manual-only.json' with { type: 'json' };

const SHOTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/screenshots');
const shot = (name: string) => path.join(SHOTS, name);

const VIDEO_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const PLAYLIST_URL = 'https://www.youtube.com/playlist?list=PL123';

function videoResolve() {
  return {
    ...manualOnly,
    title: 'Manual captions fixture',
    description: 'A fixture video used for documentation screenshots.',
    channel: 'Fixture Channel',
    views: 123456,
    uploadDate: '20240101',
  };
}

function playlistResolve() {
  return {
    ...manualOnly,
    title: 'Screenshot playlist',
    channel: 'Fixture Channel',
    is_playlist: true,
    entries: [
      { videoId: 'aaa', title: 'First video', duration: 947, thumbnail: null },
      { videoId: 'bbb', title: 'Second video', duration: 1115, thumbnail: null },
      { videoId: 'ccc', title: 'Third video', duration: 1258, thumbnail: null },
      { videoId: 'ddd', title: 'Fourth video', duration: 892, thumbnail: null },
      { videoId: 'eee', title: 'Fifth video', duration: 1041, thumbnail: null },
    ],
  };
}

function prepareOk() {
  return {
    filename: 'item.mp4',
    container: 'mp4',
    mergeRequired: false,
    sizeEstimate: 5,
    streamToken: 'tok',
    muxToken: null,
    captions: [],
  };
}

test.describe('README screenshots (wide, English)', () => {
  test('empty home', async ({ page }) => {
    const app = new KouTubePage(page);
    await app.goto();
    await page.screenshot({ path: shot('01-home-empty.png'), fullPage: true, animations: 'disabled' });
  });

  test('inspected video', async ({ page }) => {
    await page.route('**/api/resolve', (r) => r.fulfill({ json: videoResolve() }));
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(VIDEO_URL);
    await page.getByText('Manual captions fixture').first().waitFor();
    await page.locator('.thumb-wrap img.img-ready').waitFor({ timeout: 15000 });
    await page.screenshot({ path: shot('02-video-inspected.png'), fullPage: true, animations: 'disabled' });
  });

  test('expanded playlist checklist', async ({ page }) => {
    await page.route('**/api/resolve', (r) => r.fulfill({ json: playlistResolve() }));
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(PLAYLIST_URL);
    await page.getByRole('button', { name: 'Show videos' }).click();
    await page.getByRole('option', { name: /First video/ }).waitFor();
    await page.screenshot({ path: shot('03-playlist.png'), fullPage: true, animations: 'disabled' });
  });

  test('downloading queue', async ({ page }) => {
    await page.route('**/api/resolve', (r) => r.fulfill({ json: playlistResolve() }));
    await page.route('**/api/prepare', (r) => r.fulfill({ json: prepareOk() }));
    // Hang the transfer stream: rows stay mid-download for the capture.
    await page.route('**/api/stream*', () => new Promise(() => {}));
    const app = new KouTubePage(page);
    await app.goto();
    await app.inspectUrl(PLAYLIST_URL);
    await app.downloadZip();
    await page.locator('.job').first().waitFor();
    await page.screenshot({ path: shot('04-queue.png'), fullPage: true, animations: 'disabled' });
  });

  test('settings', async ({ page }) => {
    const app = new KouTubePage(page);
    await app.goto();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('heading', { name: 'Downloads' }).waitFor();
    await page.screenshot({ path: shot('05-settings.png'), fullPage: true, animations: 'disabled' });
  });
});
