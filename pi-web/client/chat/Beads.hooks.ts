'use client';
import { createContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { runtime } from './runtime';
import type { ChatWorkspace } from '../../../hosted/pi-chat-contract';
import type { PiBeadsHandle, PiBeadsSnapshot } from '../../../hosted/pi-beads';
import { boardIssues, filterIssues, initialBoardFilters, resultIds, statusColumns } from '../../../webapp/src/features/beads/board';
import { boardPreferencesKey, defaultPreferences, readPreferences, saveFilter, type BoardPreferences } from '../../../webapp/src/features/beads/preferences';
import type { BeadReference } from '../../../src/bead-context';

const idle: PiBeadsSnapshot = { phase: 'loading', results: [], error: '', workspace: { repository: '', workspace: '' } };
const emptySubscribe = () => () => {};
// Selection must update independently of SVAR's deferred card-data synchronization.
export const BeadSelection = createContext<ReadonlySet<string>>(new Set());
export function useBeads(workspace?: ChatWorkspace, host: () => Promise<Pick<Window['piWebExtension'], 'beads' | 'preferences'>> = runtime) {
  const scope = workspace ? JSON.stringify([workspace.repository, workspace.workspace]) : '';
  const [handle, setHandle] = useState<PiBeadsHandle>(), [error, setError] = useState('');
  const [preferences, setPreferences] = useState(defaultPreferences), [settingsReady, setSettingsReady] = useState(false), [saving, setSaving] = useState(false);
  const currentPreferences = useRef(preferences), settings = useRef<Awaited<ReturnType<Window['piWebExtension']['preferences']>> | undefined>(undefined), settingsKey = useRef(''), write = useRef(0);
  const [selection, setSelection] = useState<Set<string>>(new Set()), [details, setDetails] = useState(''), [menu, setMenu] = useState(false), [filtersOpen, setFiltersOpen] = useState(false), [filterName, setFilterName] = useState('');
  const currentSelection = useRef(selection); currentSelection.current = selection;
  const anchor = useRef(''), press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | undefined>(undefined), suppressClick = useRef(false);
  useEffect(() => {
    let stopped = false;
    void host().then(async api => {
      if (stopped) return;
      const next = api.beads(workspace, new URLSearchParams(location.search).get('connection') ?? undefined);
      setHandle(next); setSelection(new Set()); setDetails(''); setMenu(false); setError(''); setFiltersOpen(false);
      setSettingsReady(false); setSaving(false); anchor.current = ''; settings.current = undefined; settingsKey.current = ''; write.current++;
      if (!workspace) return;
      try {
        const [storage, key] = await Promise.all([api.preferences(), boardPreferencesKey('pi-web:' + scope)]);
        if (stopped) return;
        settings.current = storage; settingsKey.current = key;
        currentPreferences.current = readPreferences(storage.getItem(key), 'compact'); setPreferences(currentPreferences.current);
      } catch { if (!stopped) { currentPreferences.current = defaultPreferences(); setPreferences(currentPreferences.current); setError('Beads preferences could not be restored.'); } }
      finally { if (!stopped) setSettingsReady(true); }
    }).catch(reason => { if (!stopped) setError(reason instanceof Error ? reason.message : 'Beads could not be initialized.'); });
    return () => { stopped = true; if (press.current) clearTimeout(press.current.timer); };
  }, [scope, workspace, host]);
  const snapshot = useSyncExternalStore(handle?.subscribe ?? emptySubscribe, handle?.snapshot ?? (() => idle), () => idle);
  const state = snapshot.workspace.repository === workspace?.repository && snapshot.workspace.workspace === workspace?.workspace ? snapshot : idle;
  const parsed = useMemo(() => { try { return { issues: boardIssues(state.results.find(value => value.operation === 'list')?.issues ?? []), error: '' }; } catch (reason) { return { issues: [], error: String(reason) }; } }, [state.results]);
  const ready = resultIds(state.results.find(value => value.operation === 'ready')), blocked = resultIds(state.results.find(value => value.operation === 'blocked'));
  const visible = filterIssues(parsed.issues, preferences.filters, ready, blocked);
  function update(change: (value: BoardPreferences) => BoardPreferences) {
    const attempt = ++write.current;
    try {
      const next = change(currentPreferences.current), serialized = JSON.stringify(next);
      if (serialized.length > 4096) throw Error('Saved filters are full. Delete a saved filter.');
      currentPreferences.current = next; setPreferences(next); setError('');
      if (!settings.current || !settingsKey.current) throw Error('Beads preferences could not be saved.');
      settings.current.setItem(settingsKey.current, serialized); setSaving(true);
      void settings.current.flush().catch(() => { if (attempt === write.current) setError('Beads preferences could not be saved.'); }).finally(() => { if (attempt === write.current) setSaving(false); });
    } catch (reason) { setSaving(false); setError(reason instanceof Error ? reason.message : 'Filter settings could not be saved.'); }
  }
  function select(id: string, range = false) {
    setSelection(previous => {
      const next = new Set(previous);
      if (range && anchor.current) {
        const a = visible.findIndex(value => value.id === anchor.current), b = visible.findIndex(value => value.id === id);
        if (a >= 0 && b >= 0) for (const issue of visible.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(issue.id);
      } else if (next.has(id)) next.delete(id); else next.add(id);
      anchor.current = id; return next;
    });
  }
  function context(id: string) { if (!currentSelection.current.has(id)) setSelection(new Set([id])); setMenu(true); }
  function cancelPress() { if (press.current) clearTimeout(press.current.timer); press.current = undefined; }
  const cards = visible.map(issue => ({ id: issue.id, label: issue.title, column: statusColumns.some(value => value.id === issue.status && value.id !== 'other') ? issue.status : 'other', issue, ready: ready.has(issue.id), blocked: blocked.has(issue.id), selected: selection.has(issue.id), density: preferences.density,
    select: (range = false) => select(issue.id, range), open: (modified: boolean, range: boolean) => { if (suppressClick.current) { suppressClick.current = false; return; } if (modified || range) select(issue.id, range); else setDetails(issue.id); }, context: () => context(issue.id),
    down: (event: { pointerType: string; clientX: number; clientY: number }) => { if (event.pointerType === 'mouse') return; cancelPress(); press.current = { x: event.clientX, y: event.clientY, timer: setTimeout(() => { suppressClick.current = true; context(issue.id); }, 550) }; },
    move: (event: { clientX: number; clientY: number }) => { if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 8) cancelPress(); }, up: cancelPress,
  }));
  const selected: BeadReference[] = parsed.issues.filter(issue => selection.has(issue.id)).map(({ id, title }) => ({ id, title }));
  return { state, error: error || parsed.error, preferences, settingsReady, saving, cards, visible, issues: parsed.issues, total: parsed.issues.length, selected, selection, menu, filtersOpen, filterName,
    columns: statusColumns.filter(value => (value.id !== 'closed' || preferences.filters.closed) && (value.id !== 'other' || cards.some(card => card.column === 'other'))).map(value => ({ ...value, addCard: false })),
    details: parsed.issues.find(value => value.id === details), options: { labels: [...new Set(parsed.issues.flatMap(value => value.labels))].sort(), assignees: [...new Set(parsed.issues.map(value => value.assignee).filter(Boolean))].sort(), types: [...new Set(parsed.issues.map(value => value.type))].sort() },
    update, select, clearSelection: () => setSelection(new Set()), closeDetails: () => setDetails(''), closeMenu: () => setMenu(false), openMenu: () => setMenu(true), toggleFilters: () => setFiltersOpen(value => !value), setFilterName,
    filter: (patch: Partial<typeof initialBoardFilters>) => update(value => ({ ...value, filters: { ...value.filters, ...patch }, selectedView: '' })),
    clearFilters: () => update(value => ({ ...value, filters: { ...initialBoardFilters }, selectedView: '' })),
    saveFilter: () => update(value => saveFilter(value, filterName)),
    selectView: (name: string) => { update(value => ({ ...value, filters: { ...(value.views.find(view => view.name === name)?.filters ?? initialBoardFilters) }, selectedView: name })); setFilterName(name); },
    deleteView: () => update(value => ({ ...value, views: value.views.filter(view => view.name !== value.selectedView), selectedView: '' })), refresh: () => handle?.refresh(),
  };
}
export type BeadsModel = ReturnType<typeof useBeads>;
