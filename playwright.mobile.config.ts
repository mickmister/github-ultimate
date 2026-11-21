import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/mobile', workers: 1, timeout: 30000,
  outputDir: './test-results/mobile',
  use: { trace: 'retain-on-failure' },
  reporter: process.env.CI ? 'github' : 'list',
  projects: [
    { name: 'webkit-iphone', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
    { name: 'webkit-ipad', use: { ...devices['iPad Mini'], browserName: 'webkit' } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
  ],
});
