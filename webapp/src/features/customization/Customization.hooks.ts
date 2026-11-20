import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { customizationCSS, defaultCustomization, parseCustomization, resolvedCustomizationTokens, tokenNames, uiCustomization, type Customization as Theme } from '../../../../src/ui-customization';
import { builtInThemes } from '../../../../src/ui-themes';
import { applicationStorage } from '../../app-storage';
import { syncNativeTheme } from './native-theme';
import { hexColor, type ThemeToken } from './fields';
import { copy } from './Customization.copy';

const encode = (value: Theme) => JSON.stringify(value, null, 2);
function equivalent(text: string, value: Theme) {
  try { return encode(parseCustomization(text)) === encode(value); } catch { return false; }
}
export function useCustomizationFeature() {
  const revision = useSyncExternalStore(uiCustomization.subscribe, uiCustomization.snapshot, () => 0);
  const [json, setJSON] = useState(() => encode(uiCustomization.getSaved()));
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [external, setExternal] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [undo, setUndo] = useState<string | null>(null);
  const [systemMode, setSystemMode] = useState<'light' | 'dark'>('light');
  const saved = uiCustomization.getSaved(), active = uiCustomization.get();
  const savedText = encode(saved), activeText = encode(active);
  const previousSaved = useRef(savedText), latestJSON = useRef(json), operating = useRef(false);
  latestJSON.current = json;
  const validation = useMemo(() => {
    try {
      const value = parseCustomization(json);
      try { customizationCSS(value); return { value, error: '' }; }
      catch (cause) { return { value, error: cause instanceof Error ? cause.message : String(cause) }; }
    }
    catch (cause) { return { value: null, error: cause instanceof Error ? cause.message : String(cause) }; }
  }, [json]);
  const draft = validation.value;
  const dirty = !equivalent(json, saved);
  const previewing = activeText !== savedText;
  const previewMatchesDraft = equivalent(json, active);
  const selectedPreset = builtInThemes.find(({ value }) => draft && value.name === draft.name && value.mode === draft.mode && value.css === draft.css && tokenNames.every(token => value.tokens[token] === draft.tokens[token]))?.id ?? '';
  const resolved = draft ? resolvedCustomizationTokens(draft, systemMode) : {};
  const colorValues = Object.fromEntries(Object.entries(resolved).map(([key, value]) => [key, hexColor(typeof value === 'string' ? value : undefined)])) as Partial<Record<ThemeToken, string>>;

  useEffect(() => {
    if (previousSaved.current === savedText) return;
    if (!operating.current) {
      if (equivalent(latestJSON.current, parseCustomization(previousSaved.current))) setJSON(savedText);
      else setExternal(true);
    }
    previousSaved.current = savedText;
  }, [revision, savedText]);
  useEffect(() => { syncNativeTheme(); }, [revision]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => { setSystemMode(media.matches ? 'dark' : 'light'); syncNativeTheme(); };
    sync(); media.addEventListener('change', sync); window.addEventListener('alohak-native-ready', sync);
    return () => { media.removeEventListener('change', sync); window.removeEventListener('alohak-native-ready', sync); };
  }, []);
  useEffect(() => {
    let mounted = true;
    uiCustomization.configure({
      read: async () => (await applicationStorage()).getItem('github-ultimate:customization:v1'),
      write: async value => { const storage = await applicationStorage(); storage.setItem('github-ultimate:customization:v1', value); await storage.flush(); },
    });
    const detach = uiCustomization.attach(document); window.uiCustomization = uiCustomization;
    void uiCustomization.ready().then(() => { if (mounted) setReady(true); }).catch(cause => { if (mounted) setError(String(cause)); });
    return () => { mounted = false; detach(); };
  }, []);
  function load(text: string) { setJSON(text); setError(''); setNotice(''); }
  function edit(update: (value: Theme) => void) {
    try { const value = parseCustomization(json); update(value); load(encode(value)); }
    catch (cause) { setError(String(cause)); }
  }
  async function perform(operation: () => Promise<void>, message: string) {
    if (operating.current) return;
    operating.current = true; setBusy(true); setError(''); setNotice('');
    try { await operation(); setReady(true); setNotice(message); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { previousSaved.current = encode(uiCustomization.getSaved()); operating.current = false; setBusy(false); }
  }
  return {
    json, draft, saved, active, dirty, previewing, previewMatchesDraft, selectedPreset, colorValues,
    ready, busy, error, validationError: validation.error, notice, external, expanded, canUndo: undo !== null,
    actions: {
      setJSON: load,
      toggle: (id: string, open: boolean) => setExpanded(value => ({ ...value, [id]: open })),
      preset(id: string) { const preset = builtInThemes.find(theme => theme.id === id); if (preset) { setUndo(json); load(encode(preset.value)); } },
      name: (name: string) => edit(value => { value.name = name; }),
      mode: (mode: Theme['mode']) => edit(value => { value.mode = mode; }),
      token: (token: ThemeToken, text: string) => edit(value => { if (text) value.tokens[token] = text; else delete value.tokens[token]; }),
      css: (css: string) => edit(value => { value.css = css; }),
      preview: () => perform(() => uiCustomization.preview(json), copy.previewActive),
      apply: () => perform(async () => {
        await uiCustomization.apply(json); setExternal(false); setUndo(null);
      }, copy.saved),
      cancel() { uiCustomization.cancelPreview(); setNotice(copy.previewStopped); },
      reset() {
        setUndo(json); load(encode(defaultCustomization()));
        uiCustomization.cancelPreview();
        if (!ready) void perform(() => uiCustomization.reset(), copy.saved);
      },
      undo() { if (undo !== null) { load(undo); setUndo(null); } },
      useSaved() { load(encode(uiCustomization.getSaved())); setExternal(false); setUndo(json); },
      keepDraft() { setExternal(false); },
      download() {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'appearance-draft.json';
        document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      },
      async import(file: File) {
        await perform(async () => {
          if (file.size > 256 * 1024) throw new Error(copy.importTooLarge);
          const text = await file.text(); const value = parseCustomization(text); customizationCSS(value);
          setUndo(latestJSON.current); load(text);
        }, copy.imported);
      },
    },
  };
}
export type CustomizationModel = ReturnType<typeof useCustomizationFeature>;
export const CustomizationContext = createContext<CustomizationModel | null>(null);
export function useCustomizationModel() {
  const model = useContext(CustomizationContext);
  if (!model) throw new Error('CustomizationPage requires CustomizationProvider.');
  return model;
}
