import { defineConfig } from '@playwright/test';

const external = process.env.WEBAPP_STORYBOOK_URL;
const built = process.env.TEST_BUILT_ASSETS === 'true';
export default defineConfig({
  testDir: './tests/webapp-storybook', outputDir: './test-results/webapp-storybook', workers: 1,
  timeout: 60000,
  projects: [
    { name: 'existing', testIgnore: '**/device-surfaces.spec.ts' },
    { name: 'surfaces-chromium', testMatch: '**/device-surfaces.spec.ts', use: { browserName: 'chromium' } },
    { name: 'surfaces-webkit', testMatch: '**/device-surfaces.spec.ts', use: { browserName: 'webkit' } },
  ],
  use: { baseURL: external ?? 'http://127.0.0.1:6011', trace: 'retain-on-failure' },
  webServer: external ? undefined : {
    command: built ? 'python3 -m http.server 6011 --bind 127.0.0.1 --directory hosted-dist/storybook' : 'PORT=6011 pnpm run webapp:storybook', url: 'http://127.0.0.1:6011',
    reuseExistingServer: !process.env.CI, timeout: 120000,
  },
});
