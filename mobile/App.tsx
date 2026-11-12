import React, { useEffect, useRef, useState } from 'react';
import { AppState, Button, Linking, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AlohakWebView, { type AlohakWebViewHandle, type DocumentEvent } from './modules/alohak-webview';
import { deploymentURL, grantForEntry, mobileBootstrap, MobileFixtureBroker, resolveAlohakLink } from '../src/mobile-protocol';
import { AsyncPageKVStore } from '../src/page-kv';
import GitHubConnections from './GitHubConnections';
import { github } from './github';

export default function App() {
  const [input, setInput] = useState(String(Constants.expoConfig?.extra?.entryURL ?? ''));
  const [entry, setEntry] = useState('');
  const [route, setRoute] = useState('');
  const [approved, setApproved] = useState(false);
  const [storageApproved, setStorageApproved] = useState(false);
  const [document, setDocument] = useState<DocumentEvent>();
  const [bootstrap, setBootstrap] = useState('');
  const [error, setError] = useState('');
  const [showSettings, setShowSettings] = useState(true);
  const [reload, setReload] = useState(0);
  const broker = useRef(new MobileFixtureBroker(new AsyncPageKVStore(AsyncStorage), github)).current;
  const webView = useRef<AlohakWebViewHandle>(null);
  const viewKey = `${entry}:${reload}`;
  const currentViewKey = useRef(viewKey); currentViewKey.current = viewKey;
  const foreground = useRef(AppState.currentState === 'active');
  const entryRef = useRef(entry); entryRef.current = entry;
  const pendingLink = useRef<string | undefined>(undefined);
  const lastLink = useRef<string | undefined>(undefined);
  const openLink = useRef((url: string) => {});
  openLink.current = url => {
    if (!entryRef.current) { pendingLink.current = url; setError('Configure the HTTPS deployment before opening this link.'); return; }
    try {
      const target = resolveAlohakLink(url, entryRef.current);
      if (lastLink.current === url) return;
      lastLink.current = url;
      broker.invalidate(); setBootstrap(''); setRoute(target); setReload(n => n + 1); setError('');
    } catch (cause) { setError(String(cause)); }
  };
  useEffect(() => {
    void Linking.getInitialURL().then(url => { if (url) openLink.current(url); });
    const subscription = Linking.addEventListener('url', ({ url }) => openLink.current(url));
    const state = AppState.addEventListener('change', value => {
      foreground.current = value === 'active';
      if (value !== 'active') { broker.invalidate(); setBootstrap(''); }
      else { lastLink.current = undefined; setReload(n => n + 1); }
    });
    return () => { subscription.remove(); state.remove(); broker.invalidate(); };
  }, [broker]);
  function configure() {
    try {
      const url = deploymentURL(input).href;
      broker.invalidate(); broker.approve(); broker.approveStorage(); setApproved(false); setStorageApproved(false); setEntry(url); entryRef.current = url;
      setRoute(url); setBootstrap(''); setDocument(undefined); setError(''); setReload(n => n + 1);
      if (pendingLink.current) { const link = pendingLink.current; pendingLink.current = undefined; openLink.current(link); }
    } catch (cause) { setError(String(cause)); }
  }
  function onDocument(event: DocumentEvent) {
    broker.invalidate(); setBootstrap(''); setDocument(event);
    if (event.state === 'ready' && foreground.current) {
      broker.activate(event);
      setBootstrap(JSON.stringify({ documentId: event.documentId, script: mobileBootstrap(event.documentId, Platform.OS === 'ios' ? 'ios' : 'android') }));
    }
    if (event.state === 'error') setError(event.message ?? 'WebView load failed.');
  }
  const grant = entry ? grantForEntry(entry) : undefined;
  return <SafeAreaProvider><SafeAreaView style={styles.screen}>
    <View style={styles.toolbar}><Button title={showSettings ? 'Hide settings' : 'Native settings'} onPress={() => setShowSettings(v => !v)} />
      <Button title="Reload" disabled={!entry} onPress={() => { broker.invalidate(); setBootstrap(''); setReload(n => n + 1); }} /></View>
    {showSettings && <ScrollView style={styles.settings} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header">Alohak</Text>
      <Text>Approve only a deployment whose scripts you trust. GitHub credentials stay in native secure storage; page storage and GitHub approvals are independent.</Text>
      <TextInput accessibilityLabel="HTTPS entry URL" autoCapitalize="none" autoCorrect={false} value={input} onChangeText={setInput} placeholder="https://your-pages-host/project/mobile-proof.html" style={styles.input} />
      <Button title="Set deployment" onPress={configure} />
      {grant && <><Text>Fixture grant: {grant.origin}{grant.subpath}</Text>
        <View style={styles.toolbar}><Switch accessibilityLabel="Approve fixture bridge" value={approved} onValueChange={value => { broker.approve(value ? grant : undefined); setApproved(value); }} /><Text>Approve fixture bridge</Text></View>
        <Text>Page data namespace: {grant.origin}. All approved paths on this origin share data; no GitHub/S3 credentials belong here.</Text>
        <View style={styles.toolbar}><Switch accessibilityLabel="Approve page storage" value={storageApproved} onValueChange={value => { broker.approveStorage(value ? grant : undefined); setStorageApproved(value); }} /><Text>Approve page storage</Text></View></>}
      <Text>Native document: {document?.state ?? 'not loaded'} {document?.documentURL}</Text>
      <GitHubConnections grant={grant} />
    </ScrollView>}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {entry && <AlohakWebView ref={webView} key={viewKey} style={styles.webview} entryURL={route} scopeURL={grant!.origin + grant!.subpath} bootstrap={bootstrap}
      onDocument={({ nativeEvent }) => { if (currentViewKey.current === viewKey) onDocument(nativeEvent); }}
      onMessage={({ nativeEvent }) => {
        if (currentViewKey.current !== viewKey) return;
        const sender = webView.current;
        void broker.handleAsync(nativeEvent, nativeEvent.data).then(result => {
          // Each command resolves its original native message. Never route a
          // response through React state or a replacement view's current ref.
          return sender?.respond(nativeEvent.replyId, JSON.stringify(result));
        }).catch(() => {
          // Disposed native views reject commands; the page client has its own
          // bounded timeout and never retries ambiguous operations implicitly.
        });
      }} />}
  </SafeAreaView></SafeAreaProvider>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' }, toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 8 },
  settings: { flexGrow: 0, maxHeight: 300, padding: 12 }, input: { borderWidth: 1, padding: 12, fontSize: 16, marginVertical: 12 },
  error: { color: '#a00', padding: 12 }, webview: { flex: 1 },
});
