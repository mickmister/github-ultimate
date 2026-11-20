import { defineConfig } from '@playwright/test';

const external = process.env.WEBAPP_STORYBOOK_URL;
const built = process.env.TEST_BUILT_ASSETS === 'true';
const port = process.env.WEBAPP_STORYBOOK_PORT ?? '6011';
const surfaces = ['**/device-surfaces.spec.ts', '**/settings-surfaces.spec.ts', '**/customization-surfaces.spec.ts', '**/review-surfaces.spec.ts', '**/beads-surfaces.spec.ts'];
export default defineConfig({
  testDir: './tests/webapp-storybook', outputDir: './test-results/webapp-storybook', workers: 1,
  timeout: 60000,
  projects: [
    { name: 'existing', testIgnore: surfaces },
    { name: 'surfaces-chromium', testMatch: surfaces, use: { browserName: 'chromium' } },
    { name: 'surfaces-webkit', testMatch: surfaces, use: { browserName: 'webkit' } },
  ],
  use: { baseURL: external ?? `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  webServer: external ? undefined : {
    command: built ? 'python3 scripts/serve-hosted-storybook.py' : `PORT=${port} pnpm run webapp:storybook`, url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI, timeout: 120000,
  },
});
