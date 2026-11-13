import type { HostedConnection } from '../src/hosted-protocol';
import { resolveLinkConnection } from './connection-link';

export type WorkspaceRoute = { page: 'workspace'; connectionId?: string; installationId: number; repository: string; workspace: string; app: string };
export function workspaceURL(route: Omit<WorkspaceRoute, 'page' | 'app'>, app = 'beads') {
  return `#/workspace?${new URLSearchParams({ ...(route.connectionId === undefined ? {} : { connection: route.connectionId }), installation: String(route.installationId), repository: route.repository, workspace: route.workspace, app })}`;
}
export function resolveWorkspaceConnection(route: WorkspaceRoute, available: readonly HostedConnection[]): HostedConnection {
  const connection = resolveLinkConnection(route.connectionId, available);
  if (connection.installation?.id !== route.installationId) throw new Error('This workspace’s saved installation is unavailable. Return to Workspaces and choose an approved access route; no fallback was used.');
  return connection;
}
export function parseRoute(hash: string): { page: 'chooser' } | WorkspaceRoute {
  if (!hash || hash === '#' || hash === '#/' || hash === '#/workspaces') return { page: 'chooser' };
  if (!hash.startsWith('#/workspace?')) throw new Error('This dashboard page does not exist. Choose a workspace to continue.');
  const values = new URLSearchParams(hash.slice('#/workspace?'.length));
  const connectionId = values.get('connection') ?? undefined, installationId = Number(values.get('installation'));
  const repository = values.get('repository') ?? '', workspace = values.get('workspace') ?? '', app = values.get('app') ?? 'beads';
  if (connectionId !== undefined && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(connectionId) || !Number.isSafeInteger(installationId) || installationId < 1 || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository) || repository.split('/').some(part => part === '.' || part === '..') || !/^[a-zA-Z0-9_-]{1,200}$/.test(workspace) || !/^[a-z][a-z0-9.-]{0,79}$/.test(app)) throw new Error('Invalid workspace link. Choose a workspace using an approved connection.');
  return { page: 'workspace', connectionId, installationId, repository, workspace, app };
}
