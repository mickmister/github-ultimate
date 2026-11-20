import { copy } from './Navigation.copy';
export function workspaceSearch(search: Record<string, unknown>) {
  const result: Record<string, string> = {};
  for (const key of ['connection', 'repository', 'workspace']) {
    const value = search[key];
    if (typeof value === 'string' && value.trim()) result[key] = value;
  }
  return result;
}
export function navigationItems(pathname: string, search: Record<string, unknown>) {
  const query = new URLSearchParams(workspaceSearch(search)).toString();
  return (['home', 'documents', 'reviews', 'beads', 'agent', 'runs', 'settings'] as const).map(key => {
    const path = key === 'home' ? '/' : `/${key}`;
    return { key, label: copy[key], href: `#${path}${query ? `?${query}` : ''}`, active: path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`) };
  });
}
export interface NavigationProps { items: ReturnType<typeof navigationItems> }
