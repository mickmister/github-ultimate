import { useEffect, useState, useSyncExternalStore } from 'react';
import { defaultCustomization, uiCustomization } from '../../../../src/ui-customization';
import { applicationStorage } from '../../app-storage';
import { CustomizationView } from './Customization.view';

export function Customization() {
  const revision = useSyncExternalStore(uiCustomization.subscribe, uiCustomization.snapshot, () => 0);
  const [json, setJSON] = useState(() => uiCustomization.export());
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [ready, setReady] = useState(false);
  useEffect(() => { setJSON(uiCustomization.export()); }, [revision]);
  useEffect(() => {
    uiCustomization.configure({
      read: async () => (await applicationStorage()).getItem('github-ultimate:customization:v1'),
      write: async value => { const storage = await applicationStorage(); storage.setItem('github-ultimate:customization:v1', value); await storage.flush(); },
    });
    const detach = uiCustomization.attach(document); window.uiCustomization = uiCustomization;
    void uiCustomization.ready().then(() => { setJSON(uiCustomization.export()); setReady(true); }).catch(cause => setError(String(cause)));
    return detach;
  }, []);
  async function change(mode: 'apply' | 'preview' | 'reset', text = json) {
    setError(''); setNotice('');
    try {
      if (mode === 'reset') await uiCustomization.reset();
      else await uiCustomization[mode](text);
      setReady(true); setJSON(uiCustomization.export()); setNotice(mode === 'preview' ? 'Preview active; not saved. Cancel preview to restore saved settings.' : 'Customization saved on this device.');
    } catch (cause) { setError(String(cause)); }
  }
  return <CustomizationView json={json} error={error} notice={notice} ready={ready} current={uiCustomization.get()} actions={{ setJSON, apply: () => void change('apply'), preview: () => void change('preview'), reset: () => void change('reset'), cancel() { uiCustomization.cancelPreview(); setJSON(uiCustomization.export()); setNotice('Saved customization restored.'); }, download: () => uiCustomization.download(), import: async file => { if (file.size > 256 * 1024) { setError('Customization JSON exceeds 256 KiB.'); return; } await change('apply', await file.text()); }, example() { setJSON(JSON.stringify({ ...defaultCustomization(), name: 'My theme', tokens: { accent: '#27866c', radius: '4px', fontSize: '15px', contentWidth: '1200px' }, css: '[data-ui="review-choice"] { border-radius: 0; }' }, null, 2)); } }} />;
}
