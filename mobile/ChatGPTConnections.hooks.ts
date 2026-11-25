import { useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import type { MobileGrant } from '../src/mobile-protocol';
import type { PublicInferenceConnection } from '../src/inference-protocol';
import type { ChatGPTSignIn } from '../src/chatgpt-auth';
import { pi } from './pi';

export function useChatGPTConnections(grant?: MobileGrant) {
  const [records, setRecords] = useState<PublicInferenceConnection[]>([]);
  const [codes, setCodes] = useState<Record<string, ChatGPTSignIn>>({});
  const [models, setModels] = useState<Record<string, string>>({});
  const [name, setName] = useState('ChatGPT'), [model, setModel] = useState('gpt-6.1-sol');
  const [origin, setOrigin] = useState(grant?.origin ?? ''), [subpath, setSubpath] = useState(grant?.subpath ?? '/');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [active, setActive] = useState(AppState.currentState === 'active');
  const locked = useRef(false), mounted = useRef(false), foreground = useRef(active);
  async function reload() {
    const values = await pi.inference.handle({ operation: 'list' }) as PublicInferenceConnection[];
    if (!mounted.current) return;
    const selected = values.filter(item => item.provider === 'chatgpt');
    setRecords(selected);
    setModels(current => Object.fromEntries(selected.map(item => [item.id, current[item.id] ?? item.model])));
  }
  useEffect(() => {
    mounted.current = true;
    void reload().catch(() => { if (mounted.current) setError('Unlock the device to load ChatGPT connections.'); });
    const listener = AppState.addEventListener('change', state => {
      const active = state === 'active'; foreground.current = active; setActive(active);
      if (!active) { setCodes({}); setError(''); }
      else void reload().catch(() => { if (mounted.current) setError('Unlock the device and retry.'); });
    });
    return () => { mounted.current = false; listener.remove(); };
  }, []);
  async function action(work: () => Promise<void>, mutating = true) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    if (mutating) pi.clear();
    try { await work(); await reload(); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error && cause.name === 'ConnectionError' ? cause.message : 'Could not update ChatGPT. Check the connection and unlock the device.'); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  const poll = (id: string) => action(async () => {
    const value = await pi.inference.handle({ operation: 'chatgptPoll', id }) as ChatGPTSignIn;
    if (mounted.current && foreground.current) setCodes(current => ({ ...current, [id]: value }));
    if (!value) pi.clear(); // Successful credential commit invalidates old transfers.
  }, false);
  useEffect(() => {
    if (!active || busy || error) return;
    const pending = records.find(item => item.authStatus === 'connecting');
    if (!pending) return;
    const timer = setTimeout(() => { void poll(pending.id); }, Math.max(1000, codes[pending.id]?.pollAfterMs ?? 1000));
    return () => clearTimeout(timer);
  }, [active, busy, error, records, codes]);
  const start = (id: string) => action(async () => {
    const value = await pi.inference.handle({ operation: 'chatgptStart', id }) as ChatGPTSignIn;
    if (mounted.current && foreground.current) setCodes(current => ({ ...current, [id]: value }));
  });
  const add = () => action(async () => {
    const item = await pi.inference.handle({ operation: 'chatgptAdd', name, model }) as PublicInferenceConnection;
    await reload(); // Keep the new connection visible even if starting auth fails.
    const value = await pi.inference.handle({ operation: 'chatgptStart', id: item.id }) as ChatGPTSignIn;
    if (mounted.current && foreground.current) setCodes(current => ({ ...current, [item.id]: value }));
  });
  const command = (operation: 'chatgptCancel' | 'chatgptDisconnect' | 'remove', id: string) => action(async () => {
    await pi.inference.handle({ operation, id });
    if (mounted.current) setCodes(current => ({ ...current, [id]: null }));
  });
  const saveModel = (id: string) => action(async () => { await pi.inference.handle({ operation: 'chatgptModel', id, model: models[id] }); });
  const permission = (id: string, operation: 'grantOrigin' | 'revokeOrigin', pair = { origin, subpath }) => action(async () => { await pi.inference.handle({ operation, id, ...pair }); });
  const verify = () => { void Linking.openURL('https://auth.openai.com/codex/device').catch(() => setError('Could not open the system browser.')); };
  const useDeployment = () => { if (grant) { setOrigin(grant.origin); setSubpath(grant.subpath); } };
  return { records, codes, models, setModels, name, setName, model, setModel, origin, setOrigin, subpath, setSubpath, busy, error, active,
    add, start, poll, command, saveModel, permission, verify, useDeployment, retry: () => action(reload, false) };
}
export type ChatGPTConnectionsModel = ReturnType<typeof useChatGPTConnections>;
