import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/pi-web-storybook', outputDir: './test-results/pi-web-storybook', workers: 1,
  timeout: 30000, reporter: process.env.CI ? 'github' : 'list', use: { locale: 'en-US', trace: 'off' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--no-sandbox'] } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
