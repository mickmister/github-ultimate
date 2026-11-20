import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));

// Isolated static-bundle verification; the shared browser projects are parent-owned.
export default defineConfig({
  testDir: `${root}/tests/webapp-storybook`,
  testMatch: /customization(?:-surfaces)?\.spec\.ts/,
  outputDir: `${root}/test-results/customization-static`,
  workers: 1,
  timeout: 60000,
  projects: [
    { name: 'appearance-chromium', use: { browserName: 'chromium' } },
    { name: 'appearance-webkit', use: { browserName: 'webkit' } },
  ],
  use: { baseURL: 'http://127.0.0.1:4042', trace: 'retain-on-failure' },
  webServer: {
    command: 'python3 -m http.server 4042 --bind 127.0.0.1 --directory webapp/storybook-static',
    cwd: root,
    url: 'http://127.0.0.1:4042',
    timeout: 30000,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
