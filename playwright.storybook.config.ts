import { defineConfig } from '@playwright/test';

const external = process.env.STORYBOOK_URL;
const built = process.env.TEST_BUILT_ASSETS === 'true';
export default defineConfig({
  testDir: './tests/storybook', outputDir: './test-results/storybook', workers: 1,
  timeout: 120000,
  use: { baseURL: external ?? 'http://127.0.0.1:6007', trace: 'retain-on-failure' },
  webServer: external ? undefined : {
    command: built ? 'python3 -m http.server 6007 --bind 127.0.0.1 --directory storybook-static' : 'PORT=6007 pnpm run storybook', url: 'http://127.0.0.1:6007',
    reuseExistingServer: !process.env.CI, timeout: 120000,
  },
});
