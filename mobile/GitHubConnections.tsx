import React, { useEffect, useState } from 'react';
import { AppState, Button, Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ConnectionRequest, Installation, PublicConnection, Repository } from '../src/connections';
import type { MobileGrant } from '../src/mobile-protocol';
import { github, githubEnabled } from './github';

export default function GitHubConnections({ grant }: { grant?: MobileGrant }) {
  const [connections, setConnections] = useState<PublicConnection[]>([]);
  const [name, setName] = useState(''), [appId, setAppId] = useState(''), [clientId, setClientId] = useState('');
  const [installations, setInstallations] = useState<Record<string, Installation[]>>({});
  const [repositories, setRepositories] = useState<Record<string, Repository[]>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [active, setActive] = useState(AppState.currentState === 'active');
  const reload = async () => setConnections(await github.settings({ operation: 'list' }) as PublicConnection[]);
  useEffect(() => {
    void reload().catch(() => setError('Native connection storage is unavailable. Unlock the device and retry.'));
    const subscription = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);
  async function run(request: ConnectionRequest, receive?: (result: unknown) => void) {
    setBusy(true); setError('');
    try { const result = await github.settings(request); receive?.(result); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Connection operation failed. Retry explicitly.'); }
    finally { try { await reload(); } catch { setError('Native connection storage is unavailable. Unlock the device and retry.'); } setBusy(false); }
  }
  useEffect(() => {
    if (!active || busy || error || !githubEnabled) return;
    const pending = connections.filter(record => record.pending).sort((a, b) => a.pending!.nextPollAt - b.pending!.nextPollAt)[0];
    if (!pending) return;
    const timer = setTimeout(() => { void run({ operation: 'poll', id: pending.id }); }, Math.max(1000, pending.pending!.nextPollAt - Date.now()));
    return () => clearTimeout(timer);
  }, [active, busy, connections, error]);
  const action = (request: ConnectionRequest, receive?: (result: unknown) => void) => () => { void run(request, receive); };
  return <View style={styles.section}>
    <Text accessibilityRole="header">GitHub App connections</Text>
    <Text>Choose your own GitHub Apps. Tokens and device codes stay in native secure storage. Each connection needs a separate deployment grant.</Text>
    {!githubEnabled && <Text>GitHub sign-in and page reads are disabled in this build pending device isolation acceptance.</Text>}
    <TextInput accessibilityLabel="Connection name" placeholder="Connection name" value={name} onChangeText={setName} style={styles.input} />
    <TextInput accessibilityLabel="GitHub App ID" placeholder="GitHub App ID" keyboardType="number-pad" value={appId} onChangeText={setAppId} style={styles.input} />
    <TextInput accessibilityLabel="GitHub App client ID" placeholder="GitHub App client ID" autoCapitalize="none" autoCorrect={false} value={clientId} onChangeText={setClientId} style={styles.input} />
    <Button title="Add GitHub connection" disabled={busy || !githubEnabled || !name.trim() || !/^\d+$/.test(appId) || !clientId.trim()} onPress={action({ operation: 'add', name: name.trim(), appId: Number(appId), clientId: clientId.trim() }, () => { setName(''); setAppId(''); setClientId(''); })} />
    <Text>The App must enable device flow and expiring user tokens, and be installed on the repositories you want to read. No App private key or client secret is needed.</Text>
    <Button title="Manage GitHub installations" onPress={() => { void Linking.openURL('https://github.com/settings/installations').catch(() => setError('Could not open the system browser.')); }} />
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    {connections.length === 0 && <Text>No GitHub connections yet.</Text>}
    {connections.map(connection => <View key={connection.id} style={styles.connection}>
      <Text accessibilityRole="header">{connection.name} · App {connection.appId}</Text>
      <Text>{connection.connected ? `Signed in${connection.user ? ` as ${connection.user.login}` : ''}` : 'Not signed in'}</Text>
      {!connection.connected && <Button title="Start GitHub sign-in" disabled={busy || !githubEnabled} onPress={action({ operation: 'start', id: connection.id })} />}
      {connection.pending && <>
        <Text selectable>GitHub code: {connection.pending.userCode}</Text>
        <Text>Expires {new Date(connection.pending.expiresAt).toLocaleTimeString()}. Waiting while Alohak is in the foreground.</Text>
        <Button title="Open GitHub verification" onPress={() => { void Linking.openURL('https://github.com/login/device').catch(() => setError('Could not open the system browser.')); }} />
        <Button title="Check sign-in" disabled={busy || !githubEnabled} onPress={action({ operation: 'poll', id: connection.id })} />
      </>}
      {connection.connected && <>
        <Button title="Load installations" disabled={busy || !githubEnabled} onPress={action({ operation: 'installations', id: connection.id }, value => setInstallations(current => ({ ...current, [connection.id]: value as Installation[] })))} />
        {installations[connection.id]?.length === 0 && <Text>No installations found for this App and user. Install it on GitHub, then load again.</Text>}
        {installations[connection.id]?.map(installation => <Button key={installation.id} title={`Use ${installation.account.login} (${installation.id})`} disabled={busy || !githubEnabled} onPress={action({ operation: 'selectInstallation', id: connection.id, installationId: installation.id }, () => setRepositories(current => ({ ...current, [connection.id]: [] })))} />)}
        <Text>Selected installation: {connection.installation?.account ?? 'none'}</Text>
        {connection.installation && <>
          <Button title="List repositories" disabled={busy || !githubEnabled} onPress={action({ operation: 'repositories', id: connection.id }, value => setRepositories(current => ({ ...current, [connection.id]: value as Repository[] })))} />
          {repositories[connection.id] && <Text>{repositories[connection.id].length} repositories: {repositories[connection.id].slice(0, 20).map(repo => repo.full_name).join(', ')}</Text>}
          {grant && <><Text>Approve current deployment: {grant.origin}{grant.subpath}</Text><Button title="Grant this deployment GitHub reads" disabled={busy || !githubEnabled} onPress={action({ operation: 'grantOrigin', id: connection.id, ...grant })} /></>}
        </>}
        <Button title="Refresh credentials" disabled={busy || !githubEnabled} onPress={action({ operation: 'refresh', id: connection.id })} />
        {connection.expiresAt && <Text>Access token expires {new Date(connection.expiresAt).toLocaleString()}</Text>}
      </>}
      {connection.hostedGrants.map(approved => <View key={approved.origin + approved.subpath}><Text>{approved.origin}{approved.subpath}</Text><Button title="Revoke GitHub deployment access" disabled={busy} onPress={action({ operation: 'revokeOrigin', id: connection.id, ...approved })} /></View>)}
      <Button title="Disconnect GitHub connection" disabled={busy} onPress={action({ operation: 'disconnect', id: connection.id }, () => { setInstallations(current => ({ ...current, [connection.id]: [] })); setRepositories(current => ({ ...current, [connection.id]: [] })); })} />
      <Button title="Remove GitHub connection" disabled={busy} onPress={action({ operation: 'remove', id: connection.id })} />
    </View>)}
    <Text>Disconnect removes local credentials and grants. Revoke upstream authorization in GitHub settings if needed; other connections to the same App may share that authorization. Reload the hosted page after granting access.</Text>
  </View>;
}
const styles = StyleSheet.create({ section: { paddingVertical: 12, gap: 8 }, connection: { borderWidth: 1, padding: 8, gap: 8 }, input: { borderWidth: 1, padding: 10 } });
