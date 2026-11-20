import { defineConfig } from '@playwright/test';
import shared from './playwright.webapp-storybook.config';

export default defineConfig({
  ...shared,
  outputDir: './test-results/settings-surfaces',
  projects: [
    { name: 'settings-chromium', testMatch: '**/settings-surfaces.spec.ts', use: { browserName: 'chromium' } },
    { name: 'settings-webkit', testMatch: '**/settings-surfaces.spec.ts', use: { browserName: 'webkit' } },
  ],
  use: { ...shared.use, baseURL: 'http://127.0.0.1:4041' },
  webServer: {
    command: 'PORT=4041 pnpm run webapp:storybook', url: 'http://127.0.0.1:4041',
    reuseExistingServer: false, timeout: 120000,
  },
});
