import { useEffect, useMemo, useRef, useState } from 'react';
import type { BeadsResult } from '../../../../hosted/beads-sample';
import { boardIssues, filterIssues, initialBoardFilters, resultIds, statusColumns } from './board';
import { BeadsBoardView } from './BeadsBoard.view';
import { useBoardPreferences } from './useBoardPreferences';
import { saveFilter } from './preferences';

export type BeadsBoardProps = { results: BeadsResult[]; workspace: string; initialDensity?: 'compact' | 'comfortable'; preferencesScope?: string };
export function BeadsBoard({ results, workspace, initialDensity = 'compact', preferencesScope }: BeadsBoardProps) {
  const { preferences, ready: preferencesReady, error: preferencesError, update } = useBoardPreferences(preferencesScope, initialDensity);
  const { filters, density, views, selectedView } = preferences;
  const [selectedId, setSelectedId] = useState(''), [filtersOpen, setFiltersOpen] = useState(false), [filterName, setFilterName] = useState('');
  const [dark, setDark] = useState(false);
  const origin = useRef<HTMLElement | null>(null), details = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => setDark(media.matches); update();
    media.addEventListener('change', update); return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => { if (selectedId) details.current?.focus(); }, [selectedId]);
  const parsed = useMemo(() => {
    try { return { issues: boardIssues(results.find(result => result.operation === 'list')?.issues ?? []), error: '' }; }
    catch (error) { return { issues: [], error: error instanceof Error ? error.message : 'Invalid issue records.' }; }
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
  function close() { setSelectedId(''); origin.current?.focus(); }
  const cards = visible.map(issue => ({
    id: issue.id, label: issue.title, column: statusColumns.some(column => column.id === issue.status && column.id !== 'other') ? issue.status : 'other',
    issue, ready: ready.has(issue.id), blocked: blocked.has(issue.id), density,
    selected: selectedId === issue.id, open: () => select(issue.id),
  }));
  const columns = statusColumns.filter(column => (column.id !== 'closed' || filters.closed)
    && (column.id !== 'other' || cards.some(card => card.column === 'other'))).map(column => ({ ...column, addCard: false }));
  return <BeadsBoardView model={{ workspace, cards, columns, total: parsed.issues.length, filters, density, dark, options, selected,
    readyAvailable: Boolean(readyResult), blockedAvailable: Boolean(blockedResult), error: parsed.error,
    loaded: results.some(result => result.operation === 'list'), selectedReady: selected ? ready.has(selected.id) : false, selectedBlocked: selected ? blocked.has(selected.id) : false,
    preferencesReady, preferencesError, views, selectedView, filtersOpen, filterName,
  }} actions={{ filter: patch => update(current => ({ ...current, filters: { ...current.filters, ...patch }, selectedView: '' })),
    clear: () => update(current => ({ ...current, filters: { ...initialBoardFilters }, selectedView: '' })),
    density: density => update(current => ({ ...current, density })), close,
    toggleFilters: () => setFiltersOpen(value => !value), filterName: setFilterName,
    saveFilter: () => update(current => saveFilter(current, filterName)),
    selectView(name) { update(current => { const view = current.views.find(view => view.name === name); return view ? { ...current, filters: { ...view.filters }, selectedView: name } : { ...current, filters: { ...initialBoardFilters }, selectedView: '' }; }); setFilterName(name); },
    deleteView() { update(current => ({ ...current, views: current.views.filter(view => view.name !== current.selectedView), selectedView: '' })); setFilterName(''); },
  }} detailsRef={details} />;
}
