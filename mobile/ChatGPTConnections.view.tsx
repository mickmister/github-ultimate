import { StyleSheet } from 'react-native';
import { Button, Text, TextInput, View } from './Theme';
import type { MobileGrant } from '../src/mobile-protocol';
import type { ChatGPTConnectionsModel } from './ChatGPTConnections.hooks';

export function ChatGPTConnectionsView({ model: m, grant }: { model: ChatGPTConnectionsModel; grant?: MobileGrant }) {
  const field = (label: string, value: string, onChangeText: (text: string) => void) => <View><Text>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} editable={!m.busy} autoCapitalize="none" autoCorrect={false} style={styles.input} /></View>;
  return <View style={styles.section}>
    <Text accessibilityRole="header">Connect to ChatGPT</Text>
    {field('ChatGPT connection name', m.name, m.setName)}
    {field('ChatGPT model', m.model, m.setModel)}
    <Button title="Connect to ChatGPT" disabled={m.busy || !m.active} onPress={() => void m.add()} />
    {m.error ? <><Text accessibilityRole="alert">{m.error}</Text><Button title="Retry ChatGPT settings" disabled={m.busy} onPress={() => void m.retry()} /></> : null}
    {m.records.map(item => <View key={item.id} style={styles.card}>
      <Text accessibilityRole="header">{item.name}</Text><Text>ChatGPT · {item.authStatus ?? 'disconnected'}</Text>
      <Text>Codex Responses · {item.model}</Text>
      <Button title={item.authStatus === 'connected' ? `Reconnect ChatGPT: ${item.name}` : `Sign in to ChatGPT: ${item.name}`} disabled={m.busy || !m.active} onPress={() => void m.start(item.id)} />
      {item.authStatus === 'connecting' && <>
        {m.codes[item.id] && <><Text selectable accessibilityLabel={`ChatGPT code: ${item.name}`}>{m.codes[item.id]!.userCode}</Text><Text>Expires {new Date(m.codes[item.id]!.expiresAt).toLocaleTimeString()}</Text><Button title="Open ChatGPT verification" onPress={m.verify} /></>}
        <Text>Waiting for sign-in while Alohak is in the foreground.</Text>
        <Button title={`Check ChatGPT sign-in: ${item.name}`} disabled={m.busy || !m.active} onPress={() => void m.poll(item.id)} />
        <Button title={`Cancel ChatGPT sign-in: ${item.name}`} disabled={m.busy} onPress={() => void m.command('chatgptCancel', item.id)} />
      </>}
      {field(`ChatGPT model: ${item.name}`, m.models[item.id] ?? item.model, value => m.setModels(current => ({ ...current, [item.id]: value })))}
      <Button title={`Save ChatGPT model: ${item.name}`} disabled={m.busy} onPress={() => void m.saveModel(item.id)} />
      {item.authStatus === 'connected' && <Button title={`Disconnect ChatGPT: ${item.name}`} disabled={m.busy} onPress={() => void m.command('chatgptDisconnect', item.id)} />}
      {field(`ChatGPT hosted origin: ${item.name}`, m.origin, m.setOrigin)}
      {field(`ChatGPT hosted subpath: ${item.name}`, m.subpath, m.setSubpath)}
      {grant && <Button title={`Use current deployment: ${item.name}`} disabled={m.busy} onPress={m.useDeployment} />}
      <Button title={`Grant ChatGPT access: ${item.name}`} disabled={m.busy} onPress={() => void m.permission(item.id, 'grantOrigin')} />
      {item.hostedGrants.map(pair => <View key={pair.origin + pair.subpath}><Text>{pair.origin}{pair.subpath}</Text><Button title={`Revoke ChatGPT access: ${item.name} ${pair.origin}${pair.subpath}`} disabled={m.busy} onPress={() => void m.permission(item.id, 'revokeOrigin', pair)} /></View>)}
      <Button title={`Remove ChatGPT connection: ${item.name}`} disabled={m.busy} onPress={() => void m.command('remove', item.id)} />
    </View>)}
    <Text>Credentials stay in native secure storage. Device-code login must be enabled for your ChatGPT account or workspace. Disconnect removes local credentials; manage remote sessions in ChatGPT security settings.</Text>
  </View>;
}
const styles = StyleSheet.create({ section: { gap: 12 }, card: { borderWidth: 1, padding: 12, gap: 10 }, input: { borderWidth: 1, padding: 12, fontSize: 16 } });
