import type { StorybookConfig } from '@storybook/html-vite';
import { mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const config: StorybookConfig = {
  framework: '@storybook/html-vite',
  stories: ['../storybook/**/*.stories.ts'],
  core: { disableTelemetry: true, allowedHosts: ['.jamtools.dev'] },
  async viteFinal(config) {
    return mergeConfig(config, {
      server: {
        allowedHosts: ['.jamtools.dev', 'localhost', '127.0.0.1'],
        fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
        // The access-gated preview may not proxy dev WebSockets. All story
        // controls/interactions still work; refresh to pick up source edits.
        ...(process.env.STORYBOOK_PREVIEW ? { hmr: false } : {}),
      },
    });
  },
};
export default config;
