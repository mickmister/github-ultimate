export type Navigation = { connectionId: string; installationId: number; repository: string; workspace?: string; discovered: boolean };
const repositoryPattern = /^(?!\.{1,2}\/)[a-zA-Z0-9_.-]+\/(?!\.{1,2}$)[a-zA-Z0-9_.-]+$/;
const namespacePattern = /^[a-zA-Z0-9_-]{1,200}$/;
const key = () => `github-ultimate-navigation-v1:${location.pathname.replace(/(?:index|settings)\.html$/, '')}`;

export function loadNavigation(): Navigation | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(key()) ?? 'null');
    if (!value || typeof value.connectionId !== 'string' || !/^[a-f0-9-]{36}$/i.test(value.connectionId) || !Number.isSafeInteger(value.installationId) || value.installationId <= 0 || typeof value.repository !== 'string' || value.repository.length > 220 || !repositoryPattern.test(value.repository) || typeof value.discovered !== 'boolean' || value.workspace !== undefined && (typeof value.workspace !== 'string' || !namespacePattern.test(value.workspace))) return;
    return { connectionId: value.connectionId, installationId: value.installationId, repository: value.repository, workspace: value.workspace, discovered: value.discovered };
  } catch { return; }
}

export function saveNavigation(value: Navigation): boolean {
  // Whitelist navigation metadata, never serialize documents or bridge results.
  const { connectionId, installationId, repository, workspace, discovered } = value;
  try { localStorage.setItem(key(), JSON.stringify({ connectionId, installationId, repository, workspace, discovered })); return true; }
  catch { return false; }
}
export function forgetNavigation() { try { localStorage.removeItem(key()); } catch { /* Storage can be disabled. */ } }
