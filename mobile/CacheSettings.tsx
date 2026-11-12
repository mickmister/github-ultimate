import React, { useEffect, useState } from 'react';
import { Button, Switch, Text, TextInput, View } from 'react-native';
import { cacheSettingFields, cacheSettingsSchema, defaultCacheSettings, type CacheSettings as Settings } from '../src/cache-settings';
import { github } from './github';

export default function CacheSettings() {
  const [settings, setSettings] = useState<Settings>(defaultCacheSettings);
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('Loading cache settings…'), [busy, setBusy] = useState(true);
  const show = (result: { settings: Settings; status: { bytes: number; error: string } }) => {
    setSettings(result.settings); setValues(Object.fromEntries(cacheSettingFields.map(field => [field.key, String(result.settings[field.key])])));
    setStatus(`${(result.status.bytes / 1048576).toFixed(1)} MiB cached (read-through; full snapshots are not yet prefetched). ${result.status.error}`);
  };
  useEffect(() => { void github.settings({ operation: 'cacheSettings' }).then(result => show(result as Parameters<typeof show>[0])).catch(() => setStatus('Cache settings unavailable.')).finally(() => setBusy(false)); }, []);
  return <View style={{ gap: 8, paddingVertical: 12 }}><Text accessibilityRole="header">Workspace cache</Text>
    <Text>Device-local settings shared with the desktop cache contract. Cached data survives WebView replacement in native SQLite.</Text>
    <Text>Persist Dolt reads</Text><Switch accessibilityLabel="Persist Dolt reads" value={settings.cacheDolt} disabled={busy} onValueChange={cacheDolt => setSettings(current => ({ ...current, cacheDolt }))} />
    {cacheSettingFields.map(field => <View key={field.key}><Text>{field.label}</Text><TextInput accessibilityLabel={field.label} keyboardType="number-pad" editable={!busy} value={values[field.key] ?? ''} onChangeText={value => setValues(current => ({ ...current, [field.key]: value }))} style={{ borderWidth: 1, padding: 8 }} /></View>)}
    <Text accessibilityLiveRegion="polite">{status}</Text>
    <Button title="Save cache settings" disabled={busy} onPress={() => {
      setBusy(true);
      void Promise.resolve().then(async () => {
        const next = cacheSettingsSchema.parse({ ...settings, ...Object.fromEntries(cacheSettingFields.map(field => [field.key, Number(values[field.key])])) });
        show(await github.settings({ operation: 'saveCacheSettings', settings: next }) as Parameters<typeof show>[0]);
      }).catch(() => setStatus('Could not save. Check positive whole-number limits and available storage.')).finally(() => setBusy(false));
    }} />
  </View>;
}
