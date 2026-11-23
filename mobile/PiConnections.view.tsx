import { StyleSheet } from 'react-native';
import { Button, Text, TextInput, View, Switch } from './Theme';
import type { MobileGrant } from '../src/mobile-protocol';
import type { PiConnectionsModel } from './PiConnections.hooks';
export function PiConnectionsView({ model: m, grant }: { model: PiConnectionsModel; grant?: MobileGrant }) {
  const field = (label: string, value: string, onChangeText: (text: string) => void, secret = false) => <TextInput accessibilityLabel={label} placeholder={label} value={value} onChangeText={onChangeText} secureTextEntry={secret} editable={!m.busy} autoCapitalize="none" autoCorrect={false} style={styles.input} />;
  return <View style={styles.section}><Text accessibilityRole="header">Pi connections</Text><Text>Credentials stay in native secure storage. Grant each connection to the configured deployment.</Text>
    {m.error ? <Text accessibilityRole="alert">{m.error}</Text> : null}
    <Text accessibilityRole="header">Inference</Text>
    {field('Inference connection name', m.name, m.setName)}{field('Inference URL', m.url, m.setURL)}{field('Inference model', m.model, m.setModel)}{field('Inference headers JSON', m.headers, m.setHeaders, true)}
    <Button title="Save inference connection" disabled={m.busy} onPress={() => void m.addInference()} />
    {m.inference.map(item => <View key={item.id}><Text>{item.name} · {item.model}</Text><Button title={`Grant inference: ${item.name}`} disabled={m.busy || !grant} onPress={() => void m.permission('inference', item.id, 'grantOrigin')} /><Button title={`Revoke inference: ${item.name}`} disabled={m.busy || !grant} onPress={() => void m.permission('inference', item.id, 'revokeOrigin')} /><Button title={`Remove inference: ${item.name}`} disabled={m.busy} onPress={() => void m.remove('inference', item.id)} /></View>)}
    <Text accessibilityRole="header">S3 chat storage</Text>
    {field('S3 connection name', m.storageName, m.setStorageName)}{field('S3 endpoint', m.endpoint, m.setEndpoint)}{field('S3 bucket', m.bucket, m.setBucket)}{field('S3 prefix', m.prefix, m.setPrefix)}{field('S3 region', m.region, m.setRegion)}
    <View><Text>Virtual-hosted bucket addressing</Text><Switch accessibilityLabel="Virtual-hosted bucket addressing" value={m.virtualAddressing} onValueChange={m.setVirtualAddressing} disabled={m.busy} /></View>
    {field('S3 access key', m.accessKeyId, m.setAccessKeyId, true)}{field('S3 secret key', m.secretAccessKey, m.setSecretAccessKey, true)}{field('S3 session token (optional)', m.sessionToken, m.setSessionToken, true)}
    <Button title="Save S3 connection" disabled={m.busy} onPress={() => void m.addStorage()} />
    {m.storage.map(item => <View key={item.id}><Text>{item.name} · {item.bucket}/{item.prefix}</Text><Button title={`Grant S3 reads and saves: ${item.name}`} disabled={m.busy || !grant} onPress={() => void m.permission('s3', item.id, 'grantOrigin')} /><Button title={`Revoke S3: ${item.name}`} disabled={m.busy || !grant} onPress={() => void m.permission('s3', item.id, 'revokeOrigin')} /><Button title={`Remove S3: ${item.name}`} disabled={m.busy} onPress={() => void m.remove('s3', item.id)} /></View>)}
  </View>;
}
const styles = StyleSheet.create({ section: { gap: 12 }, input: { borderWidth: 1, padding: 12, fontSize: 16 } });
