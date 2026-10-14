import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: 'screenshots.spec.ts',
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'en-US',
    acceptDownloads: true,
    viewport: { width: 1600, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } } }],
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
