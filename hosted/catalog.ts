import type { HostedConnection } from '../src/hosted-protocol';
import type { HostedRequest } from '../src/hosted-protocol';
import { WorkspaceReader, type Workspace } from './workspaces';

export type Send = <T>(request: HostedRequest, timeout?: number) => Promise<T>;
export type WorkspaceAccess = {
  connection: HostedConnection; repository: string; workspace: Workspace;
  opened: Awaited<ReturnType<WorkspaceReader['open']>>;
};
type Task = { connection: HostedConnection; repository: string; workspace?: Workspace };
export const workspaceKey = (repository: string, namespace: string) => `${repository.toLowerCase()}:${namespace}`;

// The catalogue is inferred from authorized repository refs and required
// manifests. It isn't a new storage index, ownership binding or data migration.
export class WorkspaceCatalog {
  queue: Task[] = [];
  workspaces = new Map<string, WorkspaceAccess[]>();
  notices: string[] = [];
  incomplete = 0;
  constructor(private send: Send, private connections: HostedConnection[], private preferredRepository?: string) {}
  async prepare(progress: (message: string) => void, active: () => boolean) {
    for (const connection of this.connections) {
      if (!active()) return;
      progress(`Finding repositories available through ${connection.name}…`);
      try {
        const repositories = await this.send<{ full_name: string }[]>({ operation: 'repositories', id: connection.id });
        if (!active()) return;
        for (const repository of repositories) this.queue.push({ connection, repository: repository.full_name });
      } catch (error) { this.notices.push(`${connection.name}: ${error instanceof Error ? error.message : 'Repository discovery failed.'}`); }
    }
    this.queue.sort((a,b) => Number(b.repository.toLowerCase() === this.preferredRepository?.toLowerCase()) - Number(a.repository.toLowerCase() === this.preferredRepository?.toLowerCase()) || a.repository.localeCompare(b.repository));
  }
  async loadMore(progress: (message: string) => void, active: () => boolean, changed: () => void, limit = 12) {
    // Bound each user-initiated batch. All transport remains serial and uses the
    // broker's shared budgets, conditional requests and immutable-object cache.
    for (let count = 0; count < limit && this.queue.length && active(); count++) {
      const task = this.queue.shift()!;
      const { connection, repository, workspace } = task;
      if (!connection.installation) continue;
      progress(workspace ? `Verifying ${workspace.name} in ${repository}…` : `Looking for workspaces in ${repository}…`);
      try {
        const reader = new WorkspaceReader(this.send, connection.id, repository, connection.installation.id, workspace?.name);
        if (!workspace) {
          const found = await reader.discover();
          if (!active()) return;
          this.incomplete += found.filter(workspace => !workspace.documents).length;
          this.queue.unshift(...found.filter(workspace => workspace.documents).map(workspace => ({ connection, repository, workspace })));
        } else {
          const opened = await reader.open(workspace);
          if (!active()) return;
          const key = workspaceKey(repository, workspace.name), routes = this.workspaces.get(key) ?? [];
          if (!routes.some(route => route.connection.id === connection.id && route.connection.installation?.id === connection.installation?.id)) routes.push({ connection, repository, workspace, opened });
          this.workspaces.set(key, routes);
        }
      } catch (error) {
        if (!active()) return;
        const message = error instanceof Error ? error.message : 'Discovery failed.';
        if (/rate limit|retry after/i.test(message)) { this.queue.unshift(task); this.notices.push(message); break; }
        if (workspace && /manifest is required|Invalid workspace\/manifest.json/.test(message)) this.incomplete++;
        else this.notices.push(`${repository}${workspace ? ` / ${workspace.name}` : ''}: ${message}`);
      }
      changed();
    }
  }
}
