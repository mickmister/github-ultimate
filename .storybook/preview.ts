import type { Preview } from '@storybook/html-vite';

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    options: { storySort: { order: ['GitHub conversation', 'Forms', 'Workflow snapshots', 'Responses', 'Fallbacks'] } },
  },
};
export default preview;
