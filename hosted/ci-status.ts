import type { HostedConnection, HostedRequest } from '../src/hosted-protocol';
import { aggregateCi, commitCiSchema, type CommitCi } from '../src/commit-ci';
import { WorkspaceReader, type GitTransport } from './workspaces';
import type { ChatWorkspace } from './pi-chat-contract';
import { githubRepository } from './preview-slots';

export type WorkspaceCi = { workspace: ChatWorkspace; manifestVersion: string; checkedAt: string; state: CommitCi['state']; repositories: {
  path: string; repository?: string; branch: string; ci?: CommitCi; error?: string;
}[] };
type Send = <T>(request: HostedRequest) => Promise<T>;
export function ciReader(send: Send) {
  let inventory: Promise<{ connection: HostedConnection; repositories: { full_name: string }[] }[]> | undefined;
  const connectionFor = async (repository: string, preferred?: string) => {
    inventory ??= (async () => {
      const connections = await send<HostedConnection[]>({ operation: 'connections' });
      return Promise.all(connections.filter(connection => connection.installation).map(async connection => {
        try { return { connection, repositories: await send<{ full_name: string }[]>({ operation: 'repositories', id: connection.id }) }; }
        catch { return { connection, repositories: [] }; }
      }));
    })();
    const matches = (await inventory).filter(item => item.repositories.some(repo => repo.full_name.toLowerCase() === repository.toLowerCase()));
    const chosen = preferred ? matches.filter(item => item.connection.id === preferred) : matches;
    if (chosen.length !== 1) throw Error('CI requires one authorized GitHub connection for this repository.');
    return chosen[0].connection;
  };
  return {
    connectionFor,
    async read(repository: string, ref: string, preferred?: string) {
      const connection = await connectionFor(repository, preferred);
      const ci = commitCiSchema.parse(await send({ operation: 'commitCi', id: connection.id, installationId: connection.installation!.id, repository, ref }));
      if (ci.repository.toLowerCase() !== repository.toLowerCase() || ci.ref !== ref || /^[a-f0-9]{40}$/.test(ref) && ci.sha !== ref) throw Error('CI observation does not match the requested source.');
      return ci;
    },
  };
}
export async function loadWorkspaceCi(send: Send, workspace: ChatWorkspace): Promise<WorkspaceCi> {
  const reader = ciReader(send), connection = await reader.connectionFor(workspace.repository);
  const documents = new WorkspaceReader(send as GitTransport, connection.id, workspace.repository, connection.installation!.id, workspace.workspace);
  const found = (await documents.discover()).find(item => item.name === workspace.workspace && item.documents);
  if (!found) throw Error('Current workspace manifest unavailable.');
  const opened = await documents.open(found);
  const repositories = [] as WorkspaceCi['repositories'];
  for (const member of opened.manifest.repositories ?? []) {
    const remotes = [...new Set((member.remotes ?? []).map(remote => githubRepository(remote.url)).filter((value): value is string => Boolean(value)))];
    const item: WorkspaceCi['repositories'][number] = { path: member.path, branch: member.branch };
    try {
      if (remotes.length !== 1) throw Error('No unique GitHub source repository in workspace manifest.');
      item.repository = remotes[0];
      item.ci = await reader.read(remotes[0], member.branch);
    } catch (error) { item.error = error instanceof Error ? error.message : 'CI unavailable.'; }
    repositories.push(item);
  }
  return { workspace, manifestVersion: opened.version, checkedAt: new Date().toISOString(), repositories,
    state: aggregateCi(repositories.map(item => item.ci?.state ?? 'unknown'), repositories.some(item => item.error || item.ci?.partial)) };
}
