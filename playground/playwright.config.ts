import { defineConfig } from '@playwright/test';
const external = process.env.PLAYGROUND_URL;
export default defineConfig({
  testDir: '../tests/playground', workers: 1,
  use: { baseURL: external ?? 'http://127.0.0.1:5174', trace: 'retain-on-failure' },
  webServer: external ? undefined : { command: 'npm run playground -- --port 5174', url: 'http://127.0.0.1:5174', reuseExistingServer: !process.env.CI },
});
