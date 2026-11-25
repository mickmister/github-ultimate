'use client';
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react';
import type { ChatHandle, ChatSnapshot, SavedChat, ChatWorkspace } from '../../../hosted/pi-chat-contract';
import type { PublicInferenceConnection } from '../../../src/inference-protocol';
import type { PublicS3Connection } from '../../../src/s3-protocol';
import { copyText } from '@/lib/clipboard';
import { useTheme } from '@/hooks/useTheme';
import { usePreviewSlots } from './PreviewSlots.hooks';
import { brandDestination } from './brand-navigation';
import { useSettings } from './Settings.hooks';
import { chatRoute, inChatScope, routeURL, workspaceKey, type ChatRoute } from './chat-route';
import { runtime } from './runtime';
import { useBeads } from './Beads.hooks';
import { withBeadContext, type BeadReference } from '../../../src/bead-context';
export { workspaceKey } from './chat-route';

const empty: ChatSnapshot = { title: 'Alohak', messages: [], busy: false, dirty: false, phase: 'idle' };
const emptySnapshot = () => empty;
const emptySubscribe = () => () => {};
function clearConversationURL(url: URL) { for (const key of ['session', 'checkpoint', 'storage', 'view']) url.searchParams.delete(key); return url; }
const deviceSnapshot = () => innerWidth < 600 ? 'phone' : innerWidth < 1100 ? 'tablet' : 'desktop';
function subscribeDevice(listener: () => void) { window.addEventListener('resize', listener); return () => window.removeEventListener('resize', listener); }

export function useChat() {
  function openAlohak() { location.assign(brandDestination(location.href, navigator.userAgent, navigator.maxTouchPoints, 'alohakNative' in window && Boolean(window.alohakNative))); }
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
  const { settingsDialog, openSettings, closeSettings } = useSettings(presentation);
  const [inference, setInference] = useState<PublicInferenceConnection[]>([]), [storage, setStorage] = useState<PublicS3Connection[]>([]);
  const [inferenceId, setInferenceId] = useState(''), [storageId, setStorageId] = useState('');
  const [chats, setChats] = useState<SavedChat[]>([]), [search, setSearch] = useState('');
  const [route, setRoute] = useState<ChatRoute>({ kind: 'chooser' });
  const workspace = route.kind === 'workspace' ? route.workspace : undefined;
  const beads = useBeads(workspace);
  const [panel, setPanel] = useState<'chat' | 'beads'>('chat');
  const [draftBeads, setDraftBeads] = useState<BeadReference[]>([]), [pickerOpen, setPickerOpen] = useState(false), [pickerSearch, setPickerSearch] = useState('');
  const [attachment, setAttachment] = useState<{ workspace: ChatWorkspace; beads: BeadReference[]; destination: string; message: string; error: string }>();
  const [destinationSearch, setDestinationSearch] = useState('');
  const drafts = useRef(new Map<string, { text: string; beads: BeadReference[] }>());
  const [movedConversation, setMovedConversation] = useState<SavedChat>();
  const navigation = useRef('');
  const [draftMode, setDraftMode] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [draft, setDraft] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true), [phoneLibrary, setPhoneLibrary] = useState(false);
  const showList = presentation === 'phone' ? phoneLibrary : sidebarOpen;
  function setShowList(open: boolean) { if (presentation === 'phone') setPhoneLibrary(open); else setSidebarOpen(open); }
  const generation = useRef(0);
  const working = useRef(false);
  const loadingNavigation = useRef(false);
  const selectedStorage = storage.find(item => item.id === storageId), selectedInference = inference.find(item => item.id === inferenceId);
  function stashDraft() { drafts.current.set(workspaceKey(workspace) + ':' + (active.current?.snapshot().sessionId ?? 'new'), { text: draft, beads: draftBeads }); }
  function restoreDraft(session?: string, target = workspace) { const saved = drafts.current.get(workspaceKey(target) + ':' + (session ?? 'new')); setDraft(saved?.text ?? ''); setDraftBeads(saved?.beads ?? []); }
  function choosePanel(next: 'chat' | 'beads') { setPanel(next); const url = new URL(location.href); if (next === 'beads') url.searchParams.set('panel', next); else url.searchParams.delete('panel'); writeURL(url); }
  const workspaceOptions = new Map<string, ChatWorkspace>();
  for (const item of [...(previews.catalog?.workspaces ?? []), ...chats.flatMap(chat => chat.workspace ? [chat.workspace] : []), ...(workspace ? [workspace] : [])]) workspaceOptions.set(workspaceKey(item), item);
  const workspaces = [...workspaceOptions.values()];
  const canCreate = Boolean(workspace) && !movedConversation && !previews.busy && Boolean(previews.catalog?.workspaces?.some(item => workspaceKey(item) === workspaceKey(workspace)));
  function requireWorkspace(target = workspace) {
    if (!target || !previews.catalog?.workspaces?.some(item => workspaceKey(item) === workspaceKey(target))) throw Error('Load and select an authorized nugs workspace before creating or moving conversations.');
  }
  function workspaceURL(target?: ChatWorkspace) {
    return routeURL(new URL(location.href), target ? { kind: 'workspace', workspace: target } : { kind: 'inbox' }, true);
  }
  function writeURL(url: URL, replace = false) {
    history[replace ? 'replaceState' : 'pushState'](null, '', url); navigation.current = url.href;
  }
  function checkConversation(saved: SavedChat, scope = route) {
    if (!inChatScope(scope, saved.workspace)) {
      setMovedConversation(saved);
      throw Error(saved.workspace ? `This conversation belongs to workspace ${saved.workspace.workspace}. Open its workspace to continue.` : 'This conversation is Unassigned. Move it into a workspace to continue.');
    }
  }
  async function action(work: () => Promise<void>) {
    if (working.current || loadingNavigation.current || active.current?.snapshot().busy) return;
    working.current = true; setBusy(true); setError('');
    try { await work(); } catch (error) { setError(error instanceof Error ? error.message : 'Connection failed.'); }
    finally { working.current = false; setBusy(false); }
  }
  async function connect() {
    if (working.current || active.current?.snapshot().busy || active.current?.snapshot().dirty) return;
    const current = ++generation.current;
    let expectedURL = location.href;
    const params = new URL(expectedURL).searchParams;
    loadingNavigation.current = true; setBusy(true); setError('');
    try {
      setRoute({ kind: 'chooser' }); setChat(undefined); active.current = undefined; setDraftMode(false); setMovedConversation(undefined);
      let scope = chatRoute(location.search); setRoute(scope);
      setPanel(params.get('panel') === 'beads' ? 'beads' : 'chat');
      navigation.current = location.href;
      const api = await runtime();
      // Start loading immediately, independently of inference/S3/session restore.
      api.beads(scope.kind === 'workspace' ? scope.workspace : undefined, params.get('connection') ?? undefined);
      const connections = await api.connections();
      if (current !== generation.current || location.href !== expectedURL) return;
      setInference(connections.inference); setStorage(connections.storage);
      void previews.refresh();
      let remembered: string | null = null; try { remembered = localStorage.getItem('pi-web:storage'); } catch { /* Optional device-local selection hint. */ }
      const expected = params.get('storage') ?? remembered;
      const target = expected ? connections.storage.find(item => api.storageId(item) === expected) : connections.storage.length === 1 ? connections.storage[0] : undefined;
      const model = connections.inference.find(item => item.id === inferenceId) ?? (connections.inference.length === 1 ? connections.inference[0] : undefined);
      setStorageId(target?.id ?? ''); setInferenceId(model?.id ?? '');
      if (expected && !target) throw Error('Configure and grant the S3 location used by this conversation, then reconnect.');
      if (!target) return;
      const page = await api.list(target); if (current !== generation.current || location.href !== expectedURL) return; setChats(page.chats);
      const session = params.get('session'), checkpoint = params.get('checkpoint');
      if (session && model) {
        const saved = page.chats.find(item => item.sessionId === session);
        // Upgrade old unscoped links using durable catalog identity. Explicit
        // workspace links never silently switch to a conversation's new home.
        if (scope.kind === 'chooser' && saved) {
          scope = saved.workspace ? { kind: 'workspace', workspace: saved.workspace } : { kind: 'inbox' };
          setRoute(scope); writeURL(routeURL(new URL(location.href), scope, true), true); expectedURL = location.href; void previews.refresh();
        }
        if (!saved) throw Error('This conversation is not available in the selected workspace catalog.');
        checkConversation(saved, scope);
        // Ordinary conversation URLs follow the same canonical head as the
        // sidebar. Only explicitly shared checkpoint views pin old history.
        const reference = params.get('view') === 'checkpoint' ? checkpoint : page.chats.find(item => item.sessionId === session)?.reference ?? checkpoint;
        if (!reference) throw Error('This conversation is not available in the selected storage.');
        const restored = await api.restore(model, target, session, reference); if (current !== generation.current || location.href !== expectedURL) return; setChat(restored); setShowList(presentation !== 'phone');
      }
    } catch (error) { if (current === generation.current) setError(error instanceof Error ? error.message : 'Connection failed.'); }
    finally { if (current === generation.current) { loadingNavigation.current = false; setBusy(false); } }
  }
  const bootstrap = useEffectEvent(() => { void connect(); });
  const popstate = useEffectEvent(() => {
    const before = new URL(navigation.current || location.href), after = new URL(location.href);
    before.searchParams.delete('panel'); after.searchParams.delete('panel');
    if (before.href === after.href) { setPanel(new URL(location.href).searchParams.get('panel') === 'beads' ? 'beads' : 'chat'); navigation.current = location.href; return; }
    if (working.current || active.current?.snapshot().busy || active.current?.snapshot().dirty) { history.pushState(null, '', navigation.current); setError('Finish saving or stop the current turn before switching workspace.'); return; }
    bootstrap();
  });
  useEffect(() => { bootstrap(); const listener = () => popstate(); window.addEventListener('popstate', listener); const owner = generation, current = active; return () => { window.removeEventListener('popstate', listener); owner.current++; current.current?.stop(); }; }, []);
  useEffect(() => {
    if (!snapshot.sessionId || !snapshot.reference || !selectedStorage) return;
    void runtime().then(api => {
      const current = active.current?.snapshot();
      if (!current || current.sessionId !== snapshot.sessionId || current.reference !== snapshot.reference) return;
      const scope = chatRoute(location.search);
      if (scope.kind !== route.kind || route.kind === 'workspace' && !inChatScope(scope, route.workspace)) return;
      const url = new URL(location.href); url.searchParams.set('session', snapshot.sessionId!); url.searchParams.set('checkpoint', snapshot.reference!);
      url.searchParams.set('storage', api.storageId(selectedStorage)); writeURL(url, true);
    });
  }, [snapshot.sessionId, snapshot.reference, selectedStorage, route]);
  async function list() {
    await action(async () => {
      if (!selectedStorage) throw Error('Choose S3 storage.');
      const api = await runtime(), page = await api.list(selectedStorage);
      const current = active.current?.snapshot(), latest = page.chats.find(item => item.sessionId === current?.sessionId);
      setChats(page.chats);
      if (latest && !inChatScope(route, latest.workspace)) { setChat(undefined); active.current = undefined; checkConversation(latest); }
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
      checkConversation(saved);
      stashDraft();
      const restored = await (await runtime()).restore(selectedInference, selectedStorage, saved.sessionId, saved.reference);
      const url = workspaceURL(saved.workspace); url.searchParams.delete('view'); url.searchParams.set('session', saved.sessionId); url.searchParams.set('checkpoint', saved.reference); writeURL(url); setMovedConversation(undefined);
      setChat(restored); active.current = restored; setDraftMode(false); restoreDraft(saved.sessionId); setShowList(presentation !== 'phone');
    });
  }
  async function create() {
    await action(async () => {
      if (!selectedStorage || !selectedInference) throw Error('Choose storage and inference connections.');
      if (active.current?.snapshot().dirty) throw Error('Retry saving this conversation before creating another.');
      requireWorkspace();
      stashDraft(); setChat(undefined); active.current = undefined; setDraftMode(true); restoreDraft(); setShowList(presentation !== 'phone');
      writeURL(clearConversationURL(new URL(location.href)));
    });
  }
  async function send(resume = false) {
    const text = draft;
    if (!resume && !text.trim()) return;
    await action(async () => {
      if (!selectedStorage || !selectedInference) throw Error('Choose storage and inference connections.');
      if (!workspace || movedConversation) throw Error('Choose the conversation’s workspace before sending. Unassigned is a migration-only inbox.');
      const api = await runtime(); let next = active.current;
      if (!next) {
        if (!draftMode || resume) return;
        requireWorkspace();
        next = api.create(selectedInference, selectedStorage, workspace); active.current = next; setChat(next); setDraftMode(false);
        try { localStorage.setItem('pi-web:storage', api.storageId(selectedStorage)); } catch { /* S3 owns the conversation. */ }
      }
      const message = resume ? undefined : workspace ? withBeadContext(text, workspace, draftBeads) : text;
      setDraft(''); setDraftBeads([]);
      drafts.current.delete(workspaceKey(workspace) + ':' + next.snapshot().sessionId); drafts.current.delete(workspaceKey(workspace) + ':new');
      try { await next.send(resume ? undefined : message); } catch (error) { if (!resume) { setDraft(text); setDraftBeads(draftBeads); } throw error; }
      if (next.snapshot().reference) {
        const page = await api.list(selectedStorage); setChats(page.chats);
        const saved = page.chats.find(item => item.sessionId === next.snapshot().sessionId);
        if (saved && !inChatScope(route, saved.workspace)) { setChat(undefined); active.current = undefined; checkConversation(saved); }
      }
    });
  }
  function chooseStorage(id: string) {
    if (snapshot.busy || snapshot.dirty) return;
    setStorageId(id); setChats([]); setChat(undefined); setDraftMode(false); setMovedConversation(undefined); setError(''); setShowList(true);
    writeURL(clearConversationURL(new URL(location.href)));
  }
  function close() {
    if (snapshot.busy || snapshot.dirty && snapshot.messages.length) return;
    stashDraft(); setChat(undefined); active.current = undefined; setDraftMode(false); restoreDraft(); setMovedConversation(undefined); writeURL(clearConversationURL(new URL(location.href)));
  }
  function chooseWorkspace(key: string) {
    if (busy || snapshot.busy || snapshot.dirty || previews.busy) return;
    const next = workspaceOptions.get(key); if (key && key !== 'inbox' && !next) return;
    const scope: ChatRoute = next ? { kind: 'workspace', workspace: next } : key === 'inbox' ? { kind: 'inbox' } : { kind: 'chooser' };
    stashDraft(); setAttachment(undefined); setPickerOpen(false);
    if (next) restoreDraft(undefined, next); else setDraftBeads([]);
    setRoute(scope); setMovedConversation(undefined); setError(''); setChat(undefined); active.current = undefined; setDraftMode(Boolean(next) && (draftMode || Boolean(draft.trim())));
    writeURL(routeURL(new URL(location.href), scope)); setShowList(presentation !== 'phone' || scope.kind === 'inbox');
    void previews.refresh();
  }
  async function moveWorkspace(key: string) {
    await action(async () => {
      if (!selectedStorage || !snapshot.sessionId || snapshot.dirty) throw Error('Save the conversation before moving it.');
      const next = key === 'unassigned' ? undefined : workspaceOptions.get(key); if (key !== 'unassigned' && !next) throw Error('Choose a workspace.');
      if (next) requireWorkspace(next);
      const api = await runtime(); await api.move(selectedStorage, snapshot.sessionId, next ?? null);
      writeURL(workspaceURL(next)); setRoute(next ? { kind: 'workspace', workspace: next } : { kind: 'inbox' }); setMovedConversation(undefined);
      setChats((await api.list(selectedStorage)).chats);
      void previews.refresh();
    });
  }
  async function copyLink() {
    if (!snapshot.sessionId || !snapshot.reference || !selectedStorage) return;
    try {
      const url = routeURL(new URL(location.href), route, true);
      url.searchParams.set('session', snapshot.sessionId); url.searchParams.set('checkpoint', snapshot.reference);
      url.searchParams.set('storage', (await runtime()).storageId(selectedStorage)); url.searchParams.set('view', 'checkpoint');
      await copyText(url.href);
    } catch { setError('Could not copy the link. Copy the page URL from your browser.'); }
  }
  // Rendering identity is always the canonical session, even if a host mistakenly
  // repeats catalog entries. The runtime orders newest continuations first.
  const canonical = new Map<string, SavedChat>();
  for (const item of chats) if (!canonical.has(item.sessionId)) canonical.set(item.sessionId, item);
  const scopedPreviews = workspace && previews.catalog && (previews.catalog.workspace !== workspace.workspace || previews.catalog.navigation?.repository !== workspace.repository)
    ? { ...previews, catalog: undefined, error: '' } : previews;
  async function followConversation() {
    if (!movedConversation) return;
    const url = workspaceURL(movedConversation.workspace); url.searchParams.set('session', movedConversation.sessionId); url.searchParams.set('checkpoint', movedConversation.reference); writeURL(url); await connect();
  }
  function attach(refs = beads.selected) {
    if (!workspace || !refs.length) return;
    beads.closeMenu(); setDestinationSearch(''); setAttachment({ workspace, beads: refs, destination: snapshot.sessionId || draftMode ? 'current' : 'new', message: '', error: '' });
  }
  async function sendAttachment() {
    const request = attachment;
    if (!request || !request.message.trim()) return;
    await action(async () => {
      let sent = false;
      try {
        if (!selectedStorage || !selectedInference) throw Error('Choose storage and inference connections.');
        if (workspaceKey(workspace) !== workspaceKey(request.workspace)) throw Error('Workspace changed. Select Beads again.');
        if (!request.beads.length) throw Error('Select at least one Bead.');
        if (active.current?.snapshot().dirty) throw Error('Save the current conversation before attaching context.');
        requireWorkspace();
        const api = await runtime(), message = withBeadContext(request.message, request.workspace, request.beads);
        let target = request.destination === 'current' ? active.current : undefined;
        if (!target && request.destination !== 'current' && request.destination !== 'new') {
          const row = (await api.list(selectedStorage)).chats.find(value => value.sessionId === request.destination);
          if (!row || !inChatScope(route, row.workspace)) throw Error('Destination conversation is no longer in this workspace.');
          target = await api.restore(selectedInference, selectedStorage, row.sessionId, row.reference);
        }
        target ??= api.create(selectedInference, selectedStorage, request.workspace);
        if (target.snapshot().busy || target.snapshot().phase !== 'idle' || target.snapshot().dirty && target.snapshot().reference) throw Error('Resolve the destination’s unsaved or interrupted turn before sending.');
        stashDraft(); setChat(target); active.current = target; setDraftMode(false); restoreDraft(target.snapshot().sessionId); setAttachment(undefined); setPanel('chat');
        const url = new URL(location.href); url.searchParams.delete('panel'); url.searchParams.delete('view'); writeURL(url);
        await target.send(message);
        sent = true;
        setChats((await api.list(selectedStorage)).chats);
      } catch (reason) { if (!sent) setAttachment({ ...request, error: reason instanceof Error ? reason.message : 'Context could not be sent.' }); throw reason; }
    });
  }
  const workspaceChats = [...canonical.values()].filter(item => inChatScope(route, item.workspace));
  return { beads, panel, choosePanel, attachment, attach, sendAttachment, destinationSearch, setDestinationSearch, closeAttachment: () => setAttachment(undefined), changeAttachment: (patch: Partial<NonNullable<typeof attachment>>) => setAttachment(value => value ? { ...value, ...patch } : value),
    draftBeads, removeDraftBead: (id: string) => setDraftBeads(value => value.filter(bead => bead.id !== id)), pickerOpen, pickerSearch, setPickerSearch, openPicker: () => setPickerOpen(true), closePicker: () => setPickerOpen(false), addPickedBeads: () => { setDraftBeads(value => [...new Map([...value, ...beads.selected].map(bead => [bead.id, bead])).values()]); setPickerOpen(false); }, workspaceChats,
    theme, previews: scopedPreviews, route, movedConversation, followConversation, workspace, workspaces, canCreate, chooseWorkspace, moveWorkspace, snapshot, presentation, inference, storage, inferenceId, storageId, selectedStorage, selectedInference, chats: workspaceChats.filter(item => item.label.toLowerCase().includes(search.trim().toLowerCase())), search, draftMode, busy: busy || snapshot.busy, error: error || snapshot.error, draft, showList,
    settingsDialog, openSettings, closeSettings, openAlohak, setSearch, setDraft, setInferenceId, chooseStorage, setShowList, connect, list, open, create, send, close, copyLink, stop: () => chat?.stop(), retrySave: () => action(async () => { await active.current?.retrySave(); if (selectedStorage) setChats((await (await runtime()).list(selectedStorage)).chats); }) };
}
export type ChatModel = ReturnType<typeof useChat>;
