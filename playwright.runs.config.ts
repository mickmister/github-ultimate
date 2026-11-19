import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', testMatch: 'workflow-runs.spec.ts', workers: 1,
  outputDir: './test-results/runs-dev', timeout: 180000,
  use: { trace: 'retain-on-failure' },
  webServer: { command: 'pnpm run webapp:dev', url: 'http://127.0.0.1:3100', timeout: 120000, reuseExistingServer: false },
});
