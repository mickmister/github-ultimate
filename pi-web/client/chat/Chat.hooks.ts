'use client';
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react';
import type { ChatHandle, ChatSnapshot, SavedChat } from '../../../hosted/pi-chat-contract';
import type { PublicInferenceConnection } from '../../../src/inference-protocol';
import type { PublicS3Connection } from '../../../src/s3-protocol';
import { copyText } from '@/lib/clipboard';
import { useTheme } from '@/hooks/useTheme';

type Runtime = Window['piWebExtension'];
let loading: Promise<Runtime> | undefined;
function runtime() {
  return loading ??= new Promise<Runtime>((resolve, reject) => {
    const script = document.createElement('script'); script.type = 'module';
    script.src = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/extension-runtime.js?build=${encodeURIComponent(process.env.NEXT_PUBLIC_APP_VERSION ?? 'development')}`;
    script.onload = () => {
      if (window.piWebExtension?.protocolVersion !== 2) {
        loading = undefined; script.remove(); reject(Error('Pi Web resources are from different builds. Reload the page to update.')); return;
      }
      resolve(window.piWebExtension);
    };
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
  const theme = useTheme();
  const [chat, setChat] = useState<ChatHandle>();
  const active = useRef<ChatHandle | undefined>(undefined); active.current = chat;
  const snapshot = useSyncExternalStore(chat?.subscribe ?? emptySubscribe, chat?.snapshot ?? emptySnapshot, emptySnapshot);
  const presentation = useSyncExternalStore(subscribeDevice, deviceSnapshot, () => 'desktop');
  const [inference, setInference] = useState<PublicInferenceConnection[]>([]), [storage, setStorage] = useState<PublicS3Connection[]>([]);
  const [inferenceId, setInferenceId] = useState(''), [storageId, setStorageId] = useState('');
  const [chats, setChats] = useState<SavedChat[]>([]), [search, setSearch] = useState('');
  const [draftMode, setDraftMode] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [draft, setDraft] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true), [phoneLibrary, setPhoneLibrary] = useState(false);
  const showList = presentation === 'phone' ? phoneLibrary : sidebarOpen;
  function setShowList(open: boolean) { if (presentation === 'phone') setPhoneLibrary(open); else setSidebarOpen(open); }
  const generation = useRef(0);
  const working = useRef(false);
  const selectedStorage = storage.find(item => item.id === storageId), selectedInference = inference.find(item => item.id === inferenceId);
  async function action(work: () => Promise<void>) {
    if (working.current || active.current?.snapshot().busy) return;
    working.current = true; setBusy(true); setError('');
    try { await work(); } catch (error) { setError(error instanceof Error ? error.message : 'Connection failed.'); }
    finally { working.current = false; setBusy(false); }
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
      const page = await api.list(target); setChats(page.chats);
      const session = params.get('session'), checkpoint = params.get('checkpoint');
      if (session && checkpoint && model) { const restored = await api.restore(model, target, session, checkpoint); setChat(restored); setShowList(presentation !== 'phone'); }
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
  async function list() {
    await action(async () => {
      if (!selectedStorage) throw Error('Choose S3 storage.');
      const api = await runtime(), page = await api.list(selectedStorage);
      setChats(page.chats); setShowList(true);
    });
  }
  async function open(saved: SavedChat) {
    await action(async () => {
      if (!selectedStorage || !selectedInference) throw Error('Choose storage and inference connections.');
      if (active.current?.snapshot().dirty) throw Error('Retry saving this conversation before opening another.');
      setChat(await (await runtime()).restore(selectedInference, selectedStorage, saved.sessionId, saved.reference)); setDraftMode(false); setDraft(''); setShowList(presentation !== 'phone');
    });
  }
  async function create() {
    await action(async () => {
      if (!selectedStorage || !selectedInference) throw Error('Choose storage and inference connections.');
      if (active.current?.snapshot().dirty) throw Error('Retry saving this conversation before creating another.');
      setChat(undefined); active.current = undefined; setDraftMode(true); setDraft(''); setShowList(presentation !== 'phone');
      const url = new URL(location.href); url.search = ''; history.replaceState(null, '', url);
    });
  }
  async function send(resume = false) {
    const text = draft;
    if (!resume && !text.trim()) return;
    await action(async () => {
      if (!selectedStorage || !selectedInference) throw Error('Choose storage and inference connections.');
      const api = await runtime(); let next = active.current;
      if (!next) {
        if (!draftMode || resume) return;
        next = api.create(selectedInference, selectedStorage); active.current = next; setChat(next); setDraftMode(false);
        try { localStorage.setItem('pi-web:storage', api.storageId(selectedStorage)); } catch { /* S3 owns the conversation. */ }
      }
      setDraft('');
      try { await next.send(resume ? undefined : text); } catch (error) { if (!resume) setDraft(text); throw error; }
      if (next.snapshot().reference) setChats((await api.list(selectedStorage)).chats);
    });
  }
  function chooseStorage(id: string) {
    if (snapshot.busy || snapshot.dirty) return;
    setStorageId(id); setChats([]); setChat(undefined); setDraftMode(false); setShowList(true);
    const url = new URL(location.href); url.search = ''; history.replaceState(null, '', url);
  }
  function close() {
    if (snapshot.busy || snapshot.dirty && snapshot.messages.length) return;
    setChat(undefined); setDraftMode(false); setDraft(''); const url = new URL(location.href); url.search = ''; history.replaceState(null, '', url);
  }
  async function copyLink() { try { await copyText(location.href); } catch { setError('Could not copy the link. Copy the page URL from your browser.'); } }
  // Rendering identity is always the canonical session, even if a host mistakenly
  // repeats catalog entries. The runtime orders newest continuations first.
  const canonical = new Map<string, SavedChat>();
  for (const item of chats) if (!canonical.has(item.sessionId)) canonical.set(item.sessionId, item);
  return { theme, snapshot, presentation, inference, storage, inferenceId, storageId, selectedStorage, selectedInference, chats: [...canonical.values()].filter(item => item.label.toLowerCase().includes(search.trim().toLowerCase())), search, draftMode, busy: busy || snapshot.busy, error: error || snapshot.error, draft, showList,
    setSearch, setDraft, setInferenceId, chooseStorage, setShowList, connect, list, open, create, send, close, copyLink, stop: () => chat?.stop(), retrySave: () => action(async () => { await active.current?.retrySave(); if (selectedStorage) setChats((await (await runtime()).list(selectedStorage)).chats); }) };
}
export type ChatModel = ReturnType<typeof useChat>;
