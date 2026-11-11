import { defineConfig } from '@playwright/test';
const external = process.env.PLAYGROUND_URL;
const built = process.env.TEST_BUILT_ASSETS === 'true';
const port = Number(process.env.PLAYGROUND_TEST_PORT || 5174);
export default defineConfig({
  testDir: '../tests/playground', workers: 1,
  outputDir: '../test-results/playground',
  use: { baseURL: external ?? `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  webServer: external ? undefined : { command: built ? `python3 -m http.server ${port} --bind 127.0.0.1 --directory playground-dist` : `pnpm run playground --port ${port}`, url: `http://127.0.0.1:${port}`, reuseExistingServer: !process.env.CI },
});
