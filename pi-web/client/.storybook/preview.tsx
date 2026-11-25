import type { Preview } from '@storybook/react-vite';
import { I18nProvider } from '../hooks/useI18n';
import '@fontsource-variable/noto-sans-mono/wght.css';
import './fonts.css';
import 'katex/dist/katex.min.css';
import '../app/globals.css';
import '../app/settings.css';
import '../chat/chat.css';

const preview: Preview = {
  globalTypes: { theme: { description: 'Pi theme', toolbar: { icon: 'paintbrush', items: ['auto', 'light', 'dark'], dynamicTitle: true } } },
  initialGlobals: { theme: 'auto' },
  decorators: [(Story, context) => <I18nProvider><div data-theme={context.globals.theme === 'auto' ? undefined : context.globals.theme}><Story /></div></I18nProvider>],
  parameters: { layout: 'fullscreen' },
};
export default preview;
