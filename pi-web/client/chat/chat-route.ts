import type { ChatWorkspace } from '../../../hosted/pi-chat-contract';

export type ChatRoute = { kind: 'chooser' } | { kind: 'inbox' } | { kind: 'workspace'; workspace: ChatWorkspace };
export function chatRoute(search: string): ChatRoute {
  const params = new URLSearchParams(search);
  if (params.get('conversations') === 'unassigned') return { kind: 'inbox' };
  const repository = params.get('repository'), workspace = params.get('workspace');
  if (!repository && !workspace) return { kind: 'chooser' };
  if (!repository || !/^(?!\.{1,2}\/)[\w.-]+\/(?!\.{1,2}$)[\w.-]+$/.test(repository) || repository.length > 220 || !workspace || !/^[\w-]{1,200}$/.test(workspace)) throw Error('Choose a valid storage repository and nugs workspace.');
  return { kind: 'workspace', workspace: { repository, workspace } };
}
export function workspaceKey(workspace?: ChatWorkspace | null) { return workspace ? JSON.stringify([workspace.repository, workspace.workspace]) : ''; }
export function inChatScope(route: ChatRoute, workspace?: ChatWorkspace) {
  return route.kind === 'inbox' ? !workspace : route.kind === 'workspace' && workspaceKey(route.workspace) === workspaceKey(workspace);
}
export function routeURL(current: URL, route: ChatRoute, conversation = false): URL {
  const url = new URL(current);
  for (const key of ['repository', 'workspace', 'connection', 'installation', 'conversations']) url.searchParams.delete(key);
  if (!conversation) for (const key of ['session', 'checkpoint', 'storage', 'view']) url.searchParams.delete(key);
  if (route.kind === 'workspace') { url.searchParams.set('repository', route.workspace.repository); url.searchParams.set('workspace', route.workspace.workspace); }
  if (route.kind === 'inbox') url.searchParams.set('conversations', 'unassigned');
  return url;
}
