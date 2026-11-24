'use client';
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react';
import type { ChatHandle, ChatSnapshot, SavedChat, ChatWorkspace } from '../../../hosted/pi-chat-contract';
import type { PublicInferenceConnection } from '../../../src/inference-protocol';
import type { PublicS3Connection } from '../../../src/s3-protocol';
import { copyText } from '@/lib/clipboard';
import { useTheme } from '@/hooks/useTheme';
import { usePreviewSlots } from './PreviewSlots.hooks';

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
function clearConversationURL(url: URL) { for (const key of ['session', 'checkpoint', 'storage', 'view']) url.searchParams.delete(key); return url; }
export function workspaceKey(workspace?: ChatWorkspace | null) { return workspace ? JSON.stringify([workspace.repository, workspace.workspace]) : ''; }
const deviceSnapshot = () => innerWidth < 600 ? 'phone' : innerWidth < 1100 ? 'tablet' : 'desktop';
function subscribeDevice(listener: () => void) { window.addEventListener('resize', listener); return () => window.removeEventListener('resize', listener); }

export function useChat() {
  const theme = useTheme();
  const previews = usePreviewSlots(async () => {
    const api = await runtime();
    if (!api.previews) throw Error('Reload Pi Web to update preview support.');
    return api.previews(location.search);
  });
  const [chat, setChat] = useState<ChatHandle>();
  const active = useRef<ChatHandle | undefined>(undefined); active.current = chat;
  const snapshot = useSyncExternalStore(chat?.subscribe ?? emptySubscribe, chat?.snapshot ?? emptySnapshot, emptySnapshot);
  const presentation = useSyncExternalStore(subscribeDevice, deviceSnapshot, () => 'desktop');
  const [inference, setInference] = useState<PublicInferenceConnection[]>([]), [storage, setStorage] = useState<PublicS3Connection[]>([]);
  const [inferenceId, setInferenceId] = useState(''), [storageId, setStorageId] = useState('');
  const [chats, setChats] = useState<SavedChat[]>([]), [search, setSearch] = useState('');
  const [workspace, setWorkspace] = useState<ChatWorkspace>();
  const [draftMode, setDraftMode] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [draft, setDraft] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true), [phoneLibrary, setPhoneLibrary] = useState(false);
  const showList = presentation === 'phone' ? phoneLibrary : sidebarOpen;
  function setShowList(open: boolean) { if (presentation === 'phone') setPhoneLibrary(open); else setSidebarOpen(open); }
  const generation = useRef(0);
  const working = useRef(false);
  const selectedStorage = storage.find(item => item.id === storageId), selectedInference = inference.find(item => item.id === inferenceId);
  const workspaceOptions = new Map<string, ChatWorkspace>();
  for (const item of [...(previews.catalog?.workspaces ?? []), ...chats.flatMap(chat => chat.workspace ? [chat.workspace] : []), ...(workspace ? [workspace] : [])]) workspaceOptions.set(workspaceKey(item), item);
  const workspaces = [...workspaceOptions.values()];
  const canCreate = !workspace || !previews.busy && Boolean(previews.catalog?.workspaces?.some(item => workspaceKey(item) === workspaceKey(workspace)));
  function requireWorkspace(target = workspace) {
    if (target && !previews.catalog?.workspaces?.some(item => workspaceKey(item) === workspaceKey(target))) throw Error('Load and select an authorized nugs workspace before creating or moving conversations.');
  }
  function workspaceURL(target?: ChatWorkspace) {
    const url = new URL(location.href);
    if (target) {
      url.searchParams.set('repository', target.repository); url.searchParams.set('workspace', target.workspace); url.searchParams.delete('conversations');
      const navigation = previews.catalog?.navigation; if (navigation) url.searchParams.set('connection', navigation.connectionId);
    } else url.searchParams.set('conversations', 'unassigned');
    return url;
  }
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
      const repository = params.get('repository'), workspaceName = params.get('workspace');
      if (repository && workspaceName && params.get('conversations') !== 'unassigned') setWorkspace({ repository, workspace: workspaceName });
      void previews.refresh();
      let remembered: string | null = null; try { remembered = localStorage.getItem('pi-web:storage'); } catch { /* Optional device-local selection hint. */ }
      const expected = params.get('storage') ?? remembered;
      const target = expected ? connections.storage.find(item => api.storageId(item) === expected) : connections.storage.length === 1 ? connections.storage[0] : undefined;
      const model = connections.inference.find(item => item.id === inferenceId) ?? (connections.inference.length === 1 ? connections.inference[0] : undefined);
      setStorageId(target?.id ?? ''); setInferenceId(model?.id ?? '');
      if (expected && !target) throw Error('Configure and grant the S3 location used by this conversation, then reconnect.');
      if (!target) return;
      const page = await api.list(target); setChats(page.chats);
      const session = params.get('session'), checkpoint = params.get('checkpoint');
      if (session && model) {
        setWorkspace(page.chats.find(item => item.sessionId === session)?.workspace);
        // Ordinary conversation URLs follow the same canonical head as the
        // sidebar. Only explicitly shared checkpoint views pin old history.
        const reference = params.get('view') === 'checkpoint' ? checkpoint : page.chats.find(item => item.sessionId === session)?.reference ?? checkpoint;
        if (!reference) throw Error('This conversation is not available in the selected storage.');
        const restored = await api.restore(model, target, session, reference); setChat(restored); setShowList(presentation !== 'phone');
      }
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
      const current = active.current?.snapshot(), latest = page.chats.find(item => item.sessionId === current?.sessionId);
      if (latest && workspaceKey(latest.workspace) !== workspaceKey(workspace)) { setWorkspace(latest.workspace); history.replaceState(null, '', workspaceURL(latest.workspace)); }
      if (current && latest && selectedInference && !current.dirty && current.phase === 'idle' && latest.reference !== current.reference && new URL(location.href).searchParams.get('view') !== 'checkpoint') {
        setChat(await api.restore(selectedInference, selectedStorage, latest.sessionId, latest.reference));
      }
      setChats(page.chats); setShowList(true);
    });
  }
  async function open(saved: SavedChat) {
    await action(async () => {
      if (!selectedStorage || !selectedInference) throw Error('Choose storage and inference connections.');
      if (active.current?.snapshot().dirty) throw Error('Retry saving this conversation before opening another.');
      const restored = await (await runtime()).restore(selectedInference, selectedStorage, saved.sessionId, saved.reference);
      const url = workspaceURL(saved.workspace); url.searchParams.delete('view'); history.replaceState(null, '', url); setWorkspace(saved.workspace);
      setChat(restored); setDraftMode(false); setDraft(''); setShowList(presentation !== 'phone');
    });
  }
  async function create() {
    await action(async () => {
      if (!selectedStorage || !selectedInference) throw Error('Choose storage and inference connections.');
      if (active.current?.snapshot().dirty) throw Error('Retry saving this conversation before creating another.');
      requireWorkspace();
      setChat(undefined); active.current = undefined; setDraftMode(true); setDraft(''); setShowList(presentation !== 'phone');
      history.replaceState(null, '', clearConversationURL(new URL(location.href)));
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
        requireWorkspace();
        next = api.create(selectedInference, selectedStorage, workspace); active.current = next; setChat(next); setDraftMode(false);
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
    history.replaceState(null, '', clearConversationURL(new URL(location.href)));
  }
  function close() {
    if (snapshot.busy || snapshot.dirty && snapshot.messages.length) return;
    setChat(undefined); setDraftMode(false); setDraft(''); history.replaceState(null, '', clearConversationURL(new URL(location.href)));
  }
  function chooseWorkspace(key: string) {
    if (busy || snapshot.busy || snapshot.dirty || previews.busy) return;
    const next = workspaceOptions.get(key); if (key && !next) return;
    setWorkspace(next); setChat(undefined); active.current = undefined; setDraftMode(draftMode || Boolean(draft.trim()));
    history.replaceState(null, '', clearConversationURL(workspaceURL(next))); setShowList(true);
    if (next) void previews.refresh();
  }
  async function moveWorkspace(key: string) {
    await action(async () => {
      if (!selectedStorage || !snapshot.sessionId || snapshot.dirty) throw Error('Save the conversation before moving it.');
      const next = key === 'unassigned' ? undefined : workspaceOptions.get(key); if (key !== 'unassigned' && !next) throw Error('Choose a workspace.');
      if (next) requireWorkspace(next);
      const api = await runtime(); await api.move(selectedStorage, snapshot.sessionId, next ?? null);
      setWorkspace(next); setChats((await api.list(selectedStorage)).chats); history.replaceState(null, '', workspaceURL(next));
      if (next) void previews.refresh();
    });
  }
  async function copyLink() {
    if (!snapshot.sessionId || !snapshot.reference || !selectedStorage) return;
    try {
      const url = new URL(location.href);
      url.searchParams.set('session', snapshot.sessionId); url.searchParams.set('checkpoint', snapshot.reference);
      url.searchParams.set('storage', (await runtime()).storageId(selectedStorage)); url.searchParams.set('view', 'checkpoint');
      await copyText(url.href);
    } catch { setError('Could not copy the link. Copy the page URL from your browser.'); }
  }
  // Rendering identity is always the canonical session, even if a host mistakenly
  // repeats catalog entries. The runtime orders newest continuations first.
  const canonical = new Map<string, SavedChat>();
  for (const item of chats) if (!canonical.has(item.sessionId)) canonical.set(item.sessionId, item);
  return { theme, previews, workspace, workspaces, canCreate, chooseWorkspace, moveWorkspace, snapshot, presentation, inference, storage, inferenceId, storageId, selectedStorage, selectedInference, chats: [...canonical.values()].filter(item => workspaceKey(item.workspace) === workspaceKey(workspace) && item.label.toLowerCase().includes(search.trim().toLowerCase())), search, draftMode, busy: busy || snapshot.busy, error: error || snapshot.error, draft, showList,
    setSearch, setDraft, setInferenceId, chooseStorage, setShowList, connect, list, open, create, send, close, copyLink, stop: () => chat?.stop(), retrySave: () => action(async () => { await active.current?.retrySave(); if (selectedStorage) setChats((await (await runtime()).list(selectedStorage)).chats); }) };
}
export type ChatModel = ReturnType<typeof useChat>;
