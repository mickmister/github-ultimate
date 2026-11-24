import type { StorybookConfig } from '@storybook/react-vite';
import { fileURLToPath } from 'node:url';

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../stories/**/*.stories.tsx'],
  staticDirs: ['../public'],
  async viteFinal(config) {
    config.resolve = { ...config.resolve, alias: { ...config.resolve?.alias, '@': fileURLToPath(new URL('../', import.meta.url)) } };
    config.define = { ...config.define, 'process.env.NEXT_PUBLIC_BASE_PATH': JSON.stringify(''), 'process.env.NEXT_PUBLIC_APP_VERSION': JSON.stringify('storybook') };
    return config;
  },
};
export default config;
