import React, { useEffect, useRef, useState } from 'react';
import { AppState, Button, Linking, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import Constants from 'expo-constants';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import CompanionWebView, { type DocumentEvent } from './modules/companion-webview';
import { deploymentURL, grantForEntry, mobileBootstrap, mobileReplyScript, MobileFixtureBroker, resolveCompanionLink } from '../src/mobile-protocol';

export default function App() {
  const [input, setInput] = useState(String(Constants.expoConfig?.extra?.entryURL ?? ''));
  const [entry, setEntry] = useState('');
  const [route, setRoute] = useState('');
  const [approved, setApproved] = useState(false);
  const [document, setDocument] = useState<DocumentEvent>();
  const [bootstrap, setBootstrap] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const [showSettings, setShowSettings] = useState(true);
  const [reload, setReload] = useState(0);
  const broker = useRef(new MobileFixtureBroker()).current;
  const foreground = useRef(AppState.currentState === 'active');
  const entryRef = useRef(entry); entryRef.current = entry;
  const pendingLink = useRef<string | undefined>(undefined);
  const lastLink = useRef<string | undefined>(undefined);
  const openLink = useRef((url: string) => {});
  openLink.current = url => {
    if (!entryRef.current) { pendingLink.current = url; setError('Configure the HTTPS deployment before opening this link.'); return; }
    try {
      const target = resolveCompanionLink(url, entryRef.current);
      if (lastLink.current === url) return;
      lastLink.current = url;
      broker.invalidate(); setBootstrap(''); setReply(''); setRoute(target); setReload(n => n + 1); setError('');
    } catch (cause) { setError(String(cause)); }
  };
  useEffect(() => {
    void Linking.getInitialURL().then(url => { if (url) openLink.current(url); });
    const subscription = Linking.addEventListener('url', ({ url }) => openLink.current(url));
    const state = AppState.addEventListener('change', value => {
      foreground.current = value === 'active';
      if (value !== 'active') { broker.invalidate(); setBootstrap(''); setReply(''); }
      else { lastLink.current = undefined; setReload(n => n + 1); }
    });
    return () => { subscription.remove(); state.remove(); broker.invalidate(); };
  }, [broker]);
  function configure() {
    try {
      const url = deploymentURL(input).href;
      broker.invalidate(); broker.approve(); setApproved(false); setEntry(url); entryRef.current = url;
      setRoute(url); setBootstrap(''); setReply(''); setDocument(undefined); setError(''); setReload(n => n + 1);
      if (pendingLink.current) { const link = pendingLink.current; pendingLink.current = undefined; openLink.current(link); }
    } catch (cause) { setError(String(cause)); }
  }
  function onDocument(event: DocumentEvent) {
    broker.invalidate(); setBootstrap(''); setReply(''); setDocument(event);
    if (event.state === 'ready' && foreground.current) {
      broker.activate(event);
      setBootstrap(JSON.stringify({ documentId: event.documentId, script: mobileBootstrap(event.documentId, Platform.OS === 'ios' ? 'ios' : 'android') }));
    }
    if (event.state === 'error') setError(event.message ?? 'WebView load failed.');
  }
  const grant = entry ? grantForEntry(entry) : undefined;
  return <SafeAreaProvider><SafeAreaView style={styles.screen}>
    <View style={styles.toolbar}><Button title={showSettings ? 'Hide settings' : 'Native settings'} onPress={() => setShowSettings(v => !v)} />
      <Button title="Reload" disabled={!entry} onPress={() => { broker.invalidate(); setBootstrap(''); setReply(''); setReload(n => n + 1); }} /></View>
    {showSettings && <ScrollView style={styles.settings} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header">Companion M1 — fixture only</Text>
      <Text>No GitHub or S3 credentials are stored. Approve only a deployment whose scripts you trust.</Text>
      <TextInput accessibilityLabel="HTTPS entry URL" autoCapitalize="none" autoCorrect={false} value={input} onChangeText={setInput} placeholder="https://your-pages-host/project/mobile-proof.html" style={styles.input} />
      <Button title="Set deployment" onPress={configure} />
      {grant && <><Text>Fixture grant: {grant.origin}{grant.subpath}</Text>
        <View style={styles.toolbar}><Switch accessibilityLabel="Approve fixture bridge" value={approved} onValueChange={value => { broker.approve(value ? grant : undefined); setApproved(value); setReply(''); }} /><Text>Approve fixture bridge</Text></View></>}
      <Text>Native document: {document?.state ?? 'not loaded'} {document?.documentURL}</Text>
    </ScrollView>}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {entry && <CompanionWebView key={`${entry}:${reload}`} style={styles.webview} entryURL={route} scopeURL={grant!.origin + grant!.subpath} bootstrap={bootstrap} reply={reply}
      onDocument={({ nativeEvent }) => onDocument(nativeEvent)}
      onMessage={({ nativeEvent }) => {
        const result = broker.handle(nativeEvent, nativeEvent.data);
        setReply(JSON.stringify({ documentId: nativeEvent.documentId, script: mobileReplyScript(nativeEvent.documentId, JSON.stringify(result)) }));
      }} />}
  </SafeAreaView></SafeAreaProvider>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' }, toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 8 },
  settings: { flexGrow: 0, maxHeight: 300, padding: 12 }, input: { borderWidth: 1, padding: 12, fontSize: 16, marginVertical: 12 },
  error: { color: '#a00', padding: 12 }, webview: { flex: 1 },
});
