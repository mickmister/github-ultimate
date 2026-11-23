'use client';
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react';
import type { ChatHandle, ChatSnapshot, SavedChat } from '../../../hosted/pi-chat-contract';
import type { PublicInferenceConnection } from '../../../src/inference-protocol';
import type { PublicS3Connection } from '../../../src/s3-protocol';
import { copyText } from '@/lib/clipboard';

type Runtime = Window['piWebExtension'];
let loading: Promise<Runtime> | undefined;
function runtime() {
  return loading ??= new Promise<Runtime>((resolve, reject) => {
    const script = document.createElement('script'); script.type = 'module';
    script.src = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/extension-runtime.js`;
    script.onload = () => resolve(window.piWebExtension);
    script.onerror = () => { loading = undefined; script.remove(); reject(Error('Could not load Pi. Reload and retry.')); };
    document.head.append(script);
  });
}
const empty: ChatSnapshot = { title: 'Pi Web', messages: [], busy: false, dirty: false, phase: 'idle' };
const emptySnapshot = () => empty;
const emptySubscribe = () => () => {};
const deviceSnapshot = () => innerWidth < 600 ? 'phone' : innerWidth < 1100 ? 'tablet' : 'desktop';
function subscribeDevice(listener: () => void) { window.addEventListener('resize', listener); return () => window.removeEventListener('resize', listener); }

export function useChat() {
  const [chat, setChat] = useState<ChatHandle>();
  const active = useRef<ChatHandle | undefined>(undefined); active.current = chat;
  const snapshot = useSyncExternalStore(chat?.subscribe ?? emptySubscribe, chat?.snapshot ?? emptySnapshot, emptySnapshot);
  const presentation = useSyncExternalStore(subscribeDevice, deviceSnapshot, () => 'desktop');
  const [inference, setInference] = useState<PublicInferenceConnection[]>([]), [storage, setStorage] = useState<PublicS3Connection[]>([]);
  const [inferenceId, setInferenceId] = useState(''), [storageId, setStorageId] = useState('');
  const [chats, setChats] = useState<SavedChat[]>([]), [token, setToken] = useState<string>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [draft, setDraft] = useState('');
  const [showList, setShowList] = useState(false);
  const generation = useRef(0);
  const selectedStorage = storage.find(item => item.id === storageId), selectedInference = inference.find(item => item.id === inferenceId);
  async function action(work: () => Promise<void>) {
    if (busy || active.current?.snapshot().busy) return;
    setBusy(true); setError('');
    try { await work(); } catch (error) { setError(error instanceof Error ? error.message : 'Connection failed.'); }
    finally { setBusy(false); }
  }
  async function connect() {
    await action(async () => {
      const current = ++generation.current, api = await runtime(), connections = await api.connections();
      if (current !== generation.current) return;
      setInference(connections.inference); setStorage(connections.storage);
      const params = new URL(location.href).searchParams;
      let remembered: string | null = null; try { remembered = localStorage.getItem('pi-web:storage'); } catch { /* Optional device-local selection hint. */ }
      const expected = params.get('storage') ?? remembered;
      const target = expected ? connections.storage.find(item => api.storageId(item) === expected) : connections.storage.length === 1 ? connections.storage[0] : undefined;
      const model = connections.inference.find(item => item.id === inferenceId) ?? (connections.inference.length === 1 ? connections.inference[0] : undefined);
      setStorageId(target?.id ?? ''); setInferenceId(model?.id ?? '');
      if (expected && !target) throw Error('Configure and grant the S3 location used by this conversation, then reconnect.');
      if (!target) return;
      const page = await api.list(target); setChats(page.chats); setToken(page.token);
      const session = params.get('session'), checkpoint = params.get('checkpoint');
      if (session && checkpoint && model) { const restored = await api.restore(model, target, session, checkpoint); setChat(restored); setShowList(false); }
    });
  }
  const bootstrap = useEffectEvent(() => { void connect(); });
  useEffect(() => { bootstrap(); const owner = generation, current = active; return () => { owner.current++; current.current?.stop(); }; }, []);
  useEffect(() => {
    if (!snapshot.sessionId || !snapshot.reference || !selectedStorage) return;
    const url = new URL(location.href);
    url.searchParams.set('session', snapshot.sessionId); url.searchParams.set('checkpoint', snapshot.reference);
    void runtime().then(api => { url.searchParams.set('storage', api.storageId(selectedStorage)); history.replaceState(null, '', url); });
  }, [snapshot.sessionId, snapshot.reference, selectedStorage]);
  async function list(next = false) {
    await action(async () => {
      if (!selectedStorage) throw Error('Choose S3 storage.');
      const api = await runtime(), page = await api.list(selectedStorage, next ? token : undefined);
      setChats(previous => next ? [...previous, ...page.chats] : page.chats); setToken(page.token); setShowList(true);
    });
  }
  async function open(saved: SavedChat) {
    await action(async () => {
      if (!selectedStorage || !selectedInference) throw Error('Choose storage and inference connections.');
      if (active.current?.snapshot().dirty) throw Error('Retry saving this conversation before opening another.');
      setChat(await (await runtime()).restore(selectedInference, selectedStorage, saved.sessionId, saved.reference)); setShowList(false);
    });
  }
  async function create() {
    await action(async () => {
      if (!selectedStorage || !selectedInference) throw Error('Choose storage and inference connections.');
      if (active.current?.snapshot().dirty) throw Error('Retry saving this conversation before creating another.');
      const api = await runtime(), next = api.create(selectedInference, selectedStorage);
      setChat(next); setDraft(''); setShowList(false); await next.retrySave();
      try { localStorage.setItem('pi-web:storage', api.storageId(selectedStorage)); } catch { /* S3 owns the conversation. */ }
    });
  }
  async function send(resume = false) {
    if (!chat || busy || snapshot.busy) return;
    const text = draft;
    if (!resume && !text.trim()) return;
    setDraft(''); setError('');
    try { await chat.send(resume ? undefined : text); } catch (error) { if (!resume) setDraft(text); setError(error instanceof Error ? error.message : 'Could not send.'); }
  }
  function chooseStorage(id: string) {
    if (snapshot.busy || snapshot.dirty) return;
    setStorageId(id); setChats([]); setToken(undefined); setChat(undefined); setShowList(true);
    const url = new URL(location.href); url.search = ''; history.replaceState(null, '', url);
  }
  function close() {
    if (snapshot.busy || snapshot.dirty && snapshot.messages.length) return;
    setChat(undefined); const url = new URL(location.href); url.search = ''; history.replaceState(null, '', url);
  }
  async function copyLink() { try { await copyText(location.href); } catch { setError('Could not copy the link. Copy the page URL from your browser.'); } }
  return { snapshot, presentation, inference, storage, inferenceId, storageId, selectedStorage, selectedInference, chats, token, busy: busy || snapshot.busy, error: error || snapshot.error, draft, showList,
    setDraft, setInferenceId, chooseStorage, setShowList, connect, list, open, create, send, close, copyLink, stop: () => chat?.stop(), retrySave: () => chat?.retrySave() };
}
export type ChatModel = ReturnType<typeof useChat>;
