import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/browser', outputDir: './test-results/desktop', workers: 1, timeout: 30000, use: { trace: 'retain-on-failure' }, reporter: process.env.CI ? 'github' : 'list' });
