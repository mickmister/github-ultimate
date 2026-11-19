import React, { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, ScrollView, StatusBar, StyleSheet, useColorScheme } from 'react-native';
import { Button, Switch, Text, TextInput, View, ShellThemeContext } from './Theme';
import { darkShell, shellPalettes, type ShellTheme } from '../src/mobile-theme';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AlohakWebView, { type AlohakWebViewHandle, type DocumentEvent } from './AlohakWebView';
import { deploymentURL, grantForEntry, mobileBootstrap, MobileFixtureBroker, resolveAlohakLink } from '../src/mobile-protocol';
import { AsyncPageKVStore } from '../src/page-kv';
import GitHubConnections from './GitHubConnections';
import { github } from './github';
import CacheSettings from './CacheSettings';
import VdConnections from './VdConnections';
import { MobileSettingsStore, type MobileSettings } from '../src/mobile-settings';
import { MobileLifecycle } from '../src/mobile-lifecycle';

export default function App() {
  const systemMode = useColorScheme();
  const [shellTheme, setShellTheme] = useState<ShellTheme>();
  const theme = shellTheme ?? shellPalettes[systemMode === 'dark' ? 'dark' : 'light'];
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
  const [navigation, setNavigation] = useState({ key: '', back: false, forward: false });
  const [settingsBusy, setSettingsBusy] = useState(true);
  const settings = useRef(new MobileSettingsStore(AsyncStorage)).current;
  const broker = useRef(new MobileFixtureBroker(new AsyncPageKVStore(AsyncStorage), github, setShellTheme)).current;
  const webView = useRef<AlohakWebViewHandle>(null);
  const viewKey = `${entry}:${reload}`;
  const currentViewKey = useRef(viewKey); currentViewKey.current = viewKey;
  const lifecycle = useRef(new MobileLifecycle(broker, AppState.currentState === 'active')).current;
  const entryRef = useRef(entry); entryRef.current = entry;
  const pendingLink = useRef<string | undefined>(undefined);
  const lastLink = useRef<string | undefined>(undefined);
  const openLink = useRef((url: string) => {});
  function applySettings(value: MobileSettings) {
    setShellTheme(undefined);
    const url = value.entryURL, grant = grantForEntry(url);
    lifecycle.reset(); broker.approve(value.fixtureApproved ? grant : undefined); broker.approveStorage(value.storageApproved ? grant : undefined);
    setInput(url); setEntry(url); entryRef.current = url; setRoute(url);
    setApproved(value.fixtureApproved); setStorageApproved(value.storageApproved);
    setBootstrap(''); setDocument(undefined); setError(''); setReload(n => n + 1);
    lastLink.current = undefined;
    if (pendingLink.current) { const link = pendingLink.current; pendingLink.current = undefined; openLink.current(link); }
  }
  useEffect(() => {
    let stopped = false;
    void settings.load().then(value => { if (!stopped && value) applySettings(value); })
      .catch(() => { if (!stopped) setError('Could not restore the saved deployment. Set it again explicitly.'); })
      .finally(() => { if (!stopped) setSettingsBusy(false); });
    return () => { stopped = true; };
  }, [settings]);
  openLink.current = url => {
    if (!entryRef.current) { pendingLink.current = url; setError('Configure the HTTPS deployment before opening this link.'); return; }
    try {
      const target = resolveAlohakLink(url, entryRef.current);
      if (lastLink.current === url) return;
      lastLink.current = url;
      lifecycle.reset(); setBootstrap(''); setRoute(target); setReload(n => n + 1); setError('');
    } catch (cause) { setError(String(cause)); }
  };
  useEffect(() => {
    void Linking.getInitialURL().then(url => { if (url) openLink.current(url); });
    const subscription = Linking.addEventListener('url', ({ url }) => openLink.current(url));
    const state = AppState.addEventListener('change', value => {
      const ready = lifecycle.stateChanged(value);
      if (value !== 'active') setBootstrap('');
      else {
        lastLink.current = undefined;
        if (ready) setBootstrap(JSON.stringify({ documentId: ready.documentId, script: mobileBootstrap(ready.documentId, Platform.OS === 'ios' ? 'ios' : 'android') }));
      }
    });
    return () => { subscription.remove(); state.remove(); lifecycle.reset(); };
  }, [lifecycle]);
  async function saveSettings(value: MobileSettings, loadDeployment = true) {
    setSettingsBusy(true);
    try {
      await settings.save(value);
      if (loadDeployment) applySettings(value);
      else {
        const grant = grantForEntry(value.entryURL);
        broker.approve(value.fixtureApproved ? grant : undefined); broker.approveStorage(value.storageApproved ? grant : undefined);
        setApproved(value.fixtureApproved); setStorageApproved(value.storageApproved); setError('');
      }
    } catch { setError('Could not save deployment settings. Retry Set deployment before restarting; changes are not durable.'); }
    finally { setSettingsBusy(false); }
  }
  function configure() {
    try {
      const entryURL = deploymentURL(input).href, same = entryURL === entry;
      void saveSettings({ entryURL, fixtureApproved: same && approved, storageApproved: same && storageApproved });
    } catch (cause) { setError(String(cause)); }
  }
  function permission(fixtureApproved: boolean, storageApproved: boolean) {
    // Revocation takes effect before persistence, including during pending reads.
    if (!fixtureApproved) { broker.approve(); setApproved(false); }
    if (!storageApproved) { broker.approveStorage(); setStorageApproved(false); }
    void saveSettings({ entryURL: entry, fixtureApproved, storageApproved }, false);
  }
  function onDocument(event: DocumentEvent) {
    const ready = lifecycle.documentChanged(event);
    setBootstrap(''); setDocument(event);
    if (ready) {
      setBootstrap(JSON.stringify({ documentId: event.documentId, script: mobileBootstrap(event.documentId, Platform.OS === 'ios' ? 'ios' : 'android') }));
    }
    if (event.state === 'error') setError(event.message ?? 'WebView load failed.');
  }
  const grant = entry ? grantForEntry(entry) : undefined;
  return <ShellThemeContext.Provider value={theme}><SafeAreaProvider><SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
    <StatusBar barStyle={darkShell(theme) ? 'light-content' : 'dark-content'} backgroundColor={theme.background} />
    <View style={[styles.toolbar, { backgroundColor: theme.surface }]}><Button title={showSettings ? 'Hide settings' : 'Native settings'} onPress={() => setShowSettings(v => !v)} />
      <Button title="Back" disabled={navigation.key !== viewKey || !navigation.back} onPress={() => webView.current?.goBack()} />
      <Button title="Forward" disabled={navigation.key !== viewKey || !navigation.forward} onPress={() => webView.current?.goForward()} />
      <Button title="Reload" disabled={!entry} onPress={() => { lifecycle.reset(); setBootstrap(''); webView.current?.reload(); }} /></View>
    {showSettings && <ScrollView style={styles.settings} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header">Alohak</Text>
      <Text selectable>Mobile build commit: {String(Constants.expoConfig?.extra?.buildCommit ?? 'unavailable')}</Text>
      <Text>Approve only a deployment whose scripts you trust. GitHub credentials stay in native secure storage; page storage and GitHub approvals are independent.</Text>
      <Text>Paste the complete hosted deployment URL supplied by your agent. This is the website URL, not an Expo installation link. The confirmed URL and your approvals are saved on this device.</Text>
      <TextInput accessibilityLabel="HTTPS entry URL" editable={!settingsBusy} autoCapitalize="none" autoCorrect={false} value={input} onChangeText={setInput} placeholder="https://your-pages-host/project/app/" style={styles.input} />
      <Button title={settingsBusy ? 'Loading or saving deployment…' : 'Set deployment'} disabled={settingsBusy} onPress={configure} />
      {grant && <><Text>Fixture grant: {grant.origin}{grant.subpath}</Text>
        <View style={styles.toolbar}><Switch accessibilityLabel="Approve fixture bridge" disabled={settingsBusy} value={approved} onValueChange={value => permission(value, storageApproved)} /><Text>Approve fixture bridge</Text></View>
        <Text>Page data namespace: {grant.origin}. All approved paths on this origin share data; no GitHub/S3 credentials belong here.</Text>
        <View style={styles.toolbar}><Switch accessibilityLabel="Approve page storage" disabled={settingsBusy} value={storageApproved} onValueChange={value => permission(approved, value)} /><Text>Approve page storage</Text></View></>}
      <Text>Native document: {document?.state ?? 'not loaded'} {document?.documentURL}</Text>
      <GitHubConnections grant={grant} />
      <VdConnections grant={grant} />
      <CacheSettings />
    </ScrollView>}
    {error ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.error }]}>{error}</Text> : null}
    {entry && <AlohakWebView ref={webView} key={viewKey} style={[styles.webview, { backgroundColor: theme.background }]} entryURL={route} scopeURL={grant!.origin + grant!.subpath} bootstrap={bootstrap}
      onNavigation={(back, forward) => { if (currentViewKey.current === viewKey) setNavigation({ key: viewKey, back, forward }); }}
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
  </SafeAreaView></SafeAreaProvider></ShellThemeContext.Provider>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 }, toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', padding: 8 },
  settings: { flexGrow: 0, maxHeight: 300, padding: 12 }, input: { borderWidth: 1, padding: 12, fontSize: 16, marginVertical: 12 },
  error: { padding: 12 }, webview: { flex: 1 },
});
