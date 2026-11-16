import { initialBoardFilters, type BoardFilters } from './board';

export type WorkspaceChoice = { connection: string; repository: string; workspace: string };
export type SavedBoardFilter = { name: string; filters: BoardFilters };
export type BoardPreferences = { version: 1; filters: BoardFilters; density: 'compact' | 'comfortable'; views: SavedBoardFilter[]; selectedView: string };
export const lastWorkspaceKey = 'github-ultimate:beads:last-workspace:v1';
export const defaultPreferences = (density: 'compact' | 'comfortable' = 'compact'): BoardPreferences => ({ version: 1, filters: { ...initialBoardFilters }, density, views: [], selectedView: '' });
export function validWorkspace(value: WorkspaceChoice) {
  return Boolean(value.connection && value.connection.length <= 100 && value.repository.length <= 220 && /^[\w.-]+\/[\w.-]+$/.test(value.repository)
    && !value.repository.split('/').some(part => part === '.' || part === '..') && /^[a-zA-Z0-9_-]{1,200}$/.test(value.workspace));
}
export function readWorkspace(raw: string | null): WorkspaceChoice | undefined {
  try {
    const value = JSON.parse(raw ?? 'null');
    if (value && typeof value.connection === 'string' && typeof value.repository === 'string' && typeof value.workspace === 'string' && validWorkspace(value)) return { connection: value.connection, repository: value.repository, workspace: value.workspace };
  } catch { /* Ignore obsolete or malformed preferences, not host authorization errors. */ }
}
export function workspaceChoice(params: URLSearchParams, saved: WorkspaceChoice | undefined, connection: string): WorkspaceChoice {
  // A deep link selects one scope; never combine half a link with another saved workspace.
  return ['connection', 'repository', 'workspace'].some(key => params.has(key))
    ? { connection: params.get('connection') ?? connection, repository: params.get('repository') ?? '', workspace: params.get('workspace') ?? '' }
    : saved ?? { connection, repository: '', workspace: '' };
}
function readFilters(raw: unknown): BoardFilters {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const filters = { ...initialBoardFilters };
  for (const key of ['query', 'label', 'assignee', 'type', 'readiness'] as const) if (typeof value[key] === 'string') filters[key] = value[key].slice(0, 500);
  filters.readiness = ['ready', 'blocked'].includes(filters.readiness) ? filters.readiness : '';
  filters.closed = value.closed === true;
  return filters;
}
export function readPreferences(raw: string | null, density: 'compact' | 'comfortable'): BoardPreferences {
  try {
    const value = JSON.parse(raw ?? 'null');
    if (!value || value.version !== 1) return defaultPreferences(density);
    const names = new Set<string>(), views: SavedBoardFilter[] = [];
    for (const view of Array.isArray(value.views) ? value.views.slice(0, 16) : []) {
      if (!view || typeof view.name !== 'string' || !view.name.trim() || view.name.length > 60 || names.has(view.name)) continue;
      names.add(view.name); views.push({ name: view.name, filters: readFilters(view.filters) });
    }
    return { version: 1, filters: readFilters(value.filters), density: value.density === 'comfortable' ? 'comfortable' : 'compact', views, selectedView: names.has(value.selectedView) ? value.selectedView : '' };
  } catch { return defaultPreferences(density); }
}
export async function boardPreferencesKey(scope: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(scope));
  return 'github-ultimate:beads:filters:v1:' + [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
}
export function saveFilter(preferences: BoardPreferences, name: string): BoardPreferences {
  name = name.trim();
  if (!name || name.length > 60) throw new Error('Enter a filter name (up to 60 characters).');
  const views = [...preferences.views.filter(view => view.name !== name), { name, filters: { ...preferences.filters } }];
  if (views.length > 16) throw new Error('Delete a saved filter before adding another.');
  const next = { ...preferences, views, selectedView: name };
  if (JSON.stringify(next).length > 4096) throw new Error('Saved filters are full. Delete a filter or shorten its search.');
  return next;
}
