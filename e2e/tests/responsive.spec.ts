import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { KouTubePage } from '../utils/pom';
import manualOnly from '../fixtures/resolve-manual-only.json' with { type: 'json' };

const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

async function inspected(page: Page) {
  await page.route('**/api/resolve', (r) => r.fulfill({ json: manualOnly }));
  const app = new KouTubePage(page);
  await app.goto();
  await app.inspectUrl(URL);
  await expect(page.getByRole('heading', { name: 'Manual captions fixture' })).toBeVisible();
}

test.describe('responsive low-res', () => {
  test.use({ viewport: { width: 360, height: 640 } });

  test('no horizontal overflow, CTA reachable', async ({ page }) => {
    await inspected(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByLabel('Download', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Quality')).toBeVisible();
  });

  test('single column stacks on narrow screens', async ({ page }) => {
    await inspected(page);
    const info = await page.locator('.inspect-grid > div').first().boundingBox();
    const opts = await page.locator('.inspect-grid > div').nth(1).boundingBox();
    expect(info && opts && opts.y).toBeGreaterThan(info?.y ?? 0);
  });

  test('no axe violations at 360px', async ({ page }) => {
    await inspected(page);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('theme modes', () => {
  test.use({ colorScheme: 'dark' });

  test('auto follows OS dark + axe passes dark', async ({ page }) => {
    await inspected(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('theme modes light', () => {
  test.use({ colorScheme: 'light' });

  test('auto follows OS light', async ({ page }) => {
    await inspected(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('skeleton animation disabled', async ({ page }) => {
    await page.route('**/api/resolve', async (r) => {
      await new Promise((s) => setTimeout(s, 400));
      await r.fulfill({ json: manualOnly });
    });
    const app = new KouTubePage(page);
    await app.goto();
    await app.pasteUrl(URL);
    const inspect = app.inspect();
    const sk = page.locator('.sk').first();
    await expect(sk).toBeVisible();
    await expect(sk).toHaveCSS('animation-name', 'none');
    await inspect;
  });
});
  test.use({ viewport: { width: 768, height: 1024 } });

test.describe('responsive tablet', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('no horizontal overflow', async ({ page }) => {
    await inspected(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
