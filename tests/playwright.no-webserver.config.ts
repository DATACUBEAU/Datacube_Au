import { defineConfig } from '@playwright/test';
import baseConfig from '../playwright.config';

export default defineConfig({
  ...baseConfig,
  testDir: '../tests',
  use: {
    ...baseConfig.use,
    baseURL: process.env.PW_BASE_URL || baseConfig.use?.baseURL,
  },
  webServer: undefined,
});
