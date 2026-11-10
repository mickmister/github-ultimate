import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const config: StorybookConfig = {
  framework: {
    name: '@storybook/react-vite',
    // Storybook renders components directly; don't load Start's app/router plugin.
    options: { builder: { viteConfigPath: fileURLToPath(new URL('./vite.config.ts', import.meta.url)) } },
  },
  stories: ['../stories/**/*.stories.tsx'],
  core: { disableTelemetry: true, allowedHosts: ['.jamtools.dev'] },
  async viteFinal(config, { configType }) {
    return mergeConfig(config, {
      ...(configType === 'PRODUCTION' ? { base: './' } : {}),
      server: {
        allowedHosts: ['.jamtools.dev', 'localhost', '127.0.0.1'],
        fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
        ...(process.env.STORYBOOK_PREVIEW ? { hmr: false } : {}),
      },
    });
  },
};
export default config;
