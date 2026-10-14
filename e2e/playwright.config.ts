import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testIgnore: 'screenshots.spec.ts',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    // UI strings are English-asserted: pin the browser locale so auto mode
    // never resolves Spanish on non-English CI runners.
    locale: 'en-US',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    acceptDownloads: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run dev -- --port 5173 --strictPort',
      cwd: '../frontend',
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: '../.venv/bin/python -m uvicorn app.main:app --port 8000',
      cwd: '../backend',
      port: 8000,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
