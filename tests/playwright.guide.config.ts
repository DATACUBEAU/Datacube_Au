import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '../tests',
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'cmd /c "cd /d .. && node node_modules/next/dist/bin/next dev --webpack -p 3100"',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: true,
    timeout: 300_000,
  },
});
