import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BeadsResult } from '../../../../hosted/beads-sample';
import { boardIssues, filterIssues, initialBoardFilters, resultIds, statusColumns } from './board';
import { useBeadsAppearance } from './appearance';
import { useBoardPreferences } from './useBoardPreferences';
import { saveFilter } from './preferences';
import { copy } from './Beads.copy';

export type BeadsBoardProps = { results: BeadsResult[]; workspace: string; loading?: boolean; initialDensity?: 'compact' | 'comfortable'; preferencesScope?: string };
export function useBeadsBoardFeature({ results, workspace, loading = false, initialDensity = 'compact', preferencesScope }: BeadsBoardProps) {
  const { preferences, ready: preferencesReady, saving: preferencesSaving, error: preferencesError, update, dismissError } = useBoardPreferences(preferencesScope, initialDensity, workspace);
  const { filters, density, views, selectedView } = preferences;
  const [selectedId, setSelectedId] = useState(''), [filtersOpen, setFiltersOpen] = useState(false), [filterName, setFilterName] = useState('');
  const dark = useBeadsAppearance();
  const [page, setPage] = useState(0);
  const origin = useRef<HTMLElement | null>(null), details = useRef<HTMLElement | null>(null);
  useEffect(() => { setSelectedId(''); setFiltersOpen(false); setFilterName(''); setPage(0); }, [preferencesScope, workspace]);
  useEffect(() => { setPage(0); }, [filters]);
  const parsed = useMemo(() => {
    try { return { issues: boardIssues(results.find(result => result.operation === 'list')?.issues ?? []), error: '' }; }
    catch (error) { return { issues: [], error: error instanceof Error ? error.message : copy.invalidRecords }; }
  }, [results]);
  const readyResult = results.find(result => result.operation === 'ready'), blockedResult = results.find(result => result.operation === 'blocked');
  const ready = resultIds(readyResult), blocked = resultIds(blockedResult);
  const visible = filterIssues(parsed.issues, filters, ready, blocked);
  const selected = parsed.issues.find(issue => issue.id === selectedId);
  useEffect(() => { if (!results.some(result => result.operation === 'list')) setSelectedId(''); }, [results]);
  const options = {
    labels: [...new Set(parsed.issues.flatMap(issue => issue.labels))].sort(),
    assignees: [...new Set(parsed.issues.map(issue => issue.assignee).filter(Boolean))].sort(),
    types: [...new Set(parsed.issues.map(issue => issue.type))].sort(),
  };
  function select(id: string) {
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedId(id);
  }
  function close() { const id = selectedId; setSelectedId(''); requestAnimationFrame(() => { const target = document.getElementById(`beads-task-${id}`); (target ?? (origin.current?.isConnected ? origin.current : document.getElementById('beads-search')))?.focus(); }); }
  const cards = visible.map(issue => ({
    id: issue.id, label: issue.title, column: statusColumns.some(column => column.id === issue.status && column.id !== 'other') ? issue.status : 'other',
    issue, ready: ready.has(issue.id), blocked: blocked.has(issue.id), density,
    selected: selectedId === issue.id, open: () => select(issue.id),
  }));
  const columns = statusColumns.filter(column => (column.id !== 'closed' || filters.closed)
    && (column.id !== 'other' || cards.some(card => card.column === 'other'))).map(column => ({ ...column, addCard: false }));
  const boundedPage = Math.min(page, Math.max(0, Math.ceil(cards.length / 60) - 1));
  const detailsRef = useCallback((element: HTMLElement | null) => { details.current = element; if (element && selectedId) element.focus(); }, [selectedId]);
  return { model: { workspace, loading, cards, columns, total: parsed.issues.length, filters, density, dark, options, selected,
    readyAvailable: Boolean(readyResult), blockedAvailable: Boolean(blockedResult), error: parsed.error,
    loaded: results.some(result => result.operation === 'list'), selectedReady: selected ? ready.has(selected.id) : false, selectedBlocked: selected ? blocked.has(selected.id) : false,
    preferencesReady, preferencesSaving, preferencesError, views, selectedView, filtersOpen, filterName, page: boundedPage, pageCards: cards.slice(boundedPage * 60, (boundedPage + 1) * 60),
  }, actions: { filter: (patch: Partial<typeof filters>) => update(current => ({ ...current, filters: { ...current.filters, ...patch }, selectedView: '' })),
    clear: () => update(current => ({ ...current, filters: { ...initialBoardFilters }, selectedView: '' })),
    density: (density: 'compact' | 'comfortable') => update(current => ({ ...current, density })), close,
    previous: () => setPage(boundedPage - 1), next: () => setPage(boundedPage + 1),
    toggleFilters: () => setFiltersOpen(value => !value), filterName: setFilterName,
    saveFilter: () => update(current => saveFilter(current, filterName)),
    selectView(name: string) { update(current => { const view = current.views.find(view => view.name === name); return view ? { ...current, filters: { ...view.filters }, selectedView: name } : { ...current, filters: { ...initialBoardFilters }, selectedView: '' }; }); setFilterName(name); },
    deleteView() { update(current => ({ ...current, views: current.views.filter(view => view.name !== current.selectedView), selectedView: '' })); setFilterName(''); },
    dismissPreferencesError: dismissError,
   }, detailsRef };
}
export type BeadsBoardModel = ReturnType<typeof useBeadsBoardFeature>;
