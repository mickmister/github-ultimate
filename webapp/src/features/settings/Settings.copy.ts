import { defineCopy } from '../../presentation/copy';
export const copy = defineCopy({
  title: { purpose: 'heading', text: 'Settings' }, appearance: { purpose: 'action', text: 'Custom appearance' }, connections: { purpose: 'heading', text: 'Connection diagnostics' }, about: { purpose: 'heading', text: 'About' },
  build: { purpose: 'label', text: 'Hosted build' }, unavailable: { purpose: 'status', text: 'Unavailable' }, app: { purpose: 'label', text: 'GitHub Ultimate' },
  native: { purpose: 'permission', text: 'In Alohak, manage deployment, credentials and permissions in Native settings in the app toolbar.' },
  diagnostics: { purpose: 'action', text: 'Inspect approved connections and storage' },
});
