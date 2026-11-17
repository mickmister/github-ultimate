import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { parseCustomization, resolvedCustomizationTokens, tokenNames, uiCustomization, type Customization as Theme } from '../../../../src/ui-customization';
import { builtInThemes } from '../../../../src/ui-themes';
import { applicationStorage } from '../../app-storage';
import { CustomizationView } from './Customization.view';
import { hexColor, type ThemeToken } from './settings';

export function Customization() {
  const revision = useSyncExternalStore(uiCustomization.subscribe, uiCustomization.snapshot, () => 0);
  const [json, setJSON] = useState(() => uiCustomization.export());
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [ready, setReady] = useState(false);
  const draft = useMemo(() => { try { return parseCustomization(json); } catch { return null; } }, [json]);
  const selectedPreset = builtInThemes.find(({ value }) => draft && value.name === draft.name && value.mode === draft.mode && value.css === draft.css && tokenNames.every(token => value.tokens[token] === draft.tokens[token]))?.id ?? '';
  const resolved = draft ? resolvedCustomizationTokens(draft, typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : {};
  const colorValues = Object.fromEntries(Object.entries(resolved).map(([key, value]) => [key, hexColor(typeof value === 'string' ? value : undefined)]));
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
  function edit(update: (value: Theme) => void) {
    try {
      const next = parseCustomization(json); update(next);
      setJSON(JSON.stringify(parseCustomization(next), null, 2)); setError(''); setNotice('Draft updated. Preview or save to apply your changes.');
    } catch (cause) { setError(String(cause)); }
  }
  return <CustomizationView json={json} draft={draft} selectedPreset={selectedPreset} colorValues={colorValues} error={error} notice={notice} ready={ready} current={uiCustomization.get()} actions={{
    setJSON,
    preset(id) { const preset = builtInThemes.find(theme => theme.id === id); if (preset) { setJSON(JSON.stringify(preset.value, null, 2)); setError(''); setNotice('Theme loaded into draft. Preview or save to apply it.'); } },
    name: name => edit(value => { value.name = name; }), mode: mode => edit(value => { value.mode = mode; }),
    token: (token: ThemeToken, text: string) => edit(value => { if (text) value.tokens[token] = text; else delete value.tokens[token]; }),
    css: css => edit(value => { value.css = css; }),
    apply: () => void change('apply'), preview: () => void change('preview'), reset: () => void change('reset'),
    cancel() { uiCustomization.cancelPreview(); setJSON(uiCustomization.export()); setNotice('Saved customization restored.'); },
    download: () => uiCustomization.download(),
    import: async file => { try { if (file.size > 256 * 1024) throw new Error('Customization JSON exceeds 256 KiB.'); await change('apply', await file.text()); } catch (cause) { setError(String(cause)); } },
  }} />;
}
