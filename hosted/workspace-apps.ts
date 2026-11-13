import type { WorkspaceAccess } from './catalog';
import type { WorkspaceReader } from './workspaces';

export type WorkspaceAppContext = WorkspaceAccess & { reader: WorkspaceReader; signal: AbortSignal };
export type WorkspaceAppModule = { mount(root: HTMLElement, context: WorkspaceAppContext): void | Promise<void> };
export type WorkspaceApp = { id: string; kind: string; title: string; description: string; load(): Promise<WorkspaceAppModule> };

export function defineWorkspaceApps(definitions: WorkspaceApp[]): ReadonlyMap<string, WorkspaceApp> {
  const apps = new Map<string, WorkspaceApp>();
  for (const app of definitions) {
    if (!/^[a-z][a-z0-9.-]{0,79}$/.test(app.id) || apps.has(app.id)) throw new Error('Workspace apps require unique stable IDs.');
    apps.set(app.id, app);
  }
  return apps;
}

// Trusted, lazy-loaded UI modules. Semantic kind IDs are strings so custom types
// can compose installed views without changing an exhaustive core type enum.
// A manifest/resource never supplies executable code or privileged endpoints.
export const workspaceApps = defineWorkspaceApps([
  { id: 'beads', kind: 'beads', title: 'Beads', description: 'Authoritative task data in Dolt', load: () => import('./apps/beads') },
  { id: 'documents', kind: 'documents', title: 'Documents', description: 'Workspace documents in github.dev', load: () => import('./apps/documents') },
]);
