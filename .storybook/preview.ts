import type { Preview } from '@storybook/html-vite';

const preview: Preview = {
  parameters: {
    layout: 'padded',
    options: { storySort: { order: ['Forms', 'Workflow snapshots', 'Responses', 'Fallbacks'] } },
  },
};
export default preview;
