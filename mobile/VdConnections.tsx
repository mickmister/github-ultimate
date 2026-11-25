import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Button, Text, TextInput, View } from './Theme';
import { vd } from './github';
import type { MobileGrant } from '../src/mobile-protocol';
import type { PublicVdConnection, VdDraft, VdSettingsRequest } from '../src/vd-protocol';

const fresh = (): VdDraft => ({ name: '', origin: '', headers: [] });
export default function VdConnections({ grant }: { grant?: MobileGrant }) {
  const [records, setRecords] = useState<PublicVdConnection[]>([]), [draft, setDraft] = useState<VdDraft>(fresh);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  async function reload() { setRecords(await vd.handle({ operation: 'list' }) as PublicVdConnection[]); }
  useEffect(() => { void reload().catch(() => setNotice('Unlock the device to read VD settings.')); }, []);
  async function run(request: VdSettingsRequest) {
    setBusy(true); setNotice('');
    try {
      const value = await vd.handle(request) as { message?: string };
      if (request.operation === 'save') setDraft(fresh());
      setNotice(value?.message ?? 'VD settings updated.'); await reload();
    } catch (error) { setNotice(error instanceof Error && error.name !== 'ZodError' ? error.message : 'VD settings unavailable.'); }
    finally { if (request.operation === 'save') setDraft(current => ({ ...current, headers: current.headers.map(header => header.mode === 'secret' ? { name: header.name, mode: header.mode } : header) })); setBusy(false); }
  }
  return <View style={styles.section}>
    <Text accessibilityRole="header">VD / Vibe Kanban connections</Text>
    <Text>Connect a VD instance for all accessible workspaces. Each review request selects its originating workspace and session. Headers stay in native secure storage.</Text>
    {(['name', 'origin'] as const).map(key => <TextInput key={key} accessibilityLabel={`VD ${key}`} placeholder={`VD ${key}`} autoCapitalize="none" autoCorrect={false} editable={!busy} style={styles.input} value={draft[key]} onChangeText={value => setDraft({ ...draft, [key]: value })} />)}
    {draft.headers.map((header, index) => <View key={index}>
      <TextInput accessibilityLabel={`VD header ${index + 1} name`} placeholder="Header name" autoCapitalize="none" editable={!busy} style={styles.input} value={header.name} onChangeText={name => setDraft({ ...draft, headers: draft.headers.map((h, i) => i === index ? { ...h, name } : h) })} />
      <Button title={header.mode === 'secret' ? 'Secret header (change to plaintext)' : 'Plaintext header (change to secret)'} disabled={busy} onPress={() => setDraft({ ...draft, headers: draft.headers.map((h, i) => i === index ? { name: h.name, mode: h.mode === 'secret' ? 'plaintext' : 'secret', value: '' } : h) })} />
      <TextInput accessibilityLabel={`VD header ${index + 1} replacement value`} placeholder="Replacement value; unchanged saved secret may be left blank" secureTextEntry={header.mode === 'secret'} autoCapitalize="none" autoCorrect={false} editable={!busy} style={styles.input} value={header.value ?? ''} onChangeText={value => setDraft({ ...draft, headers: draft.headers.map((h, i) => i === index ? { ...h, value } : h) })} />
      <Button title="Remove header" disabled={busy} onPress={() => setDraft({ ...draft, headers: draft.headers.filter((_, i) => i !== index) })} />
    </View>)}
    <Button title="Add VD header" disabled={busy} onPress={() => setDraft({ ...draft, headers: [...draft.headers, { name: '', mode: 'secret', value: '' }] })} />
    <Button title="Test VD connection" disabled={busy} onPress={() => void run({ operation: 'test', draft })} />
    <Button title="Save VD connection" disabled={busy} onPress={() => void run({ operation: 'save', draft })} />
    <Button title="Cancel VD edit" disabled={busy} onPress={() => setDraft(fresh())} />
    <Text selectable accessibilityLiveRegion="polite">{notice}</Text>
    {records.map(record => <View key={record.id} style={styles.card}>
      <Text>{record.name} · {record.origin}</Text><Text>All accessible workspaces</Text>
      {record.headers.map(header => <Text key={header.name}>{header.name}: {header.mode === 'secret' ? 'Secret configured' : header.value}</Text>)}
      <Button title="Edit VD connection" disabled={busy} onPress={() => setDraft({ id: record.id, name: record.name, origin: record.origin, headers: record.headers.map(header => ({ name: header.name, mode: header.mode, ...(header.mode === 'plaintext' ? { value: header.value } : {}) })) })} />
      {grant && <Button title="Grant current deployment VK continuation" disabled={busy} onPress={() => void run({ operation: 'grantOrigin', id: record.id, ...grant })} />}
      {record.hostedGrants.map(item => <View key={item.origin + item.subpath}><Text>{item.origin}{item.subpath}</Text><Button title="Revoke VD deployment grant" disabled={busy} onPress={() => void run({ operation: 'revokeOrigin', id: record.id, ...item })} /></View>)}
      <Button title="Remove VD connection" disabled={busy} onPress={() => void run({ operation: 'remove', id: record.id })} />
    </View>)}
  </View>;
}
const styles = StyleSheet.create({ section: { paddingVertical: 12, gap: 8 }, card: { borderWidth: 1, padding: 8, gap: 8 }, input: { borderWidth: 1, padding: 10 } });
