import { defineConfig } from '@playwright/test';

const external = process.env.STORYBOOK_URL;
export default defineConfig({
  testDir: './tests/storybook', outputDir: './test-results/storybook', workers: 1,
  timeout: 120000,
  use: { baseURL: external ?? 'http://127.0.0.1:6007', trace: 'retain-on-failure' },
  webServer: external ? undefined : {
    command: 'PORT=6007 npm run storybook', url: 'http://127.0.0.1:6007',
    reuseExistingServer: !process.env.CI, timeout: 120000,
  },
});
