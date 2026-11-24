import { obj, str } from '@earendil-works/pi-schema';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { z } from 'zod';
import { workflowTools, workflowReportSchema, workflowScope } from '../src/workflow-interface';
import type { HostedConnection } from '../src/hosted-protocol';
import type { GitRef } from '../src/git-reads';
import { documentText, WorkspaceReader, type GitTransport } from './workspaces';
import { executeWorkflowCode } from './workflow-codemode';
import type { PiBridge } from './pi-transport';
import type { ChatWorkspace } from './pi-chat-contract';

const scopeSchema = z.object({ repository: z.string(), workspace: z.string() });
export function piWorkflowTools(send: PiBridge, currentWorkspace: () => Promise<ChatWorkspace | undefined>, beforeLaunch: () => Promise<void> = async () => {}): AgentTool[] {
  async function readerFor(workspace: ChatWorkspace, connectionId?: string) {
    const connections = await send<HostedConnection[]>({ operation: 'connections' });
    const matches: HostedConnection[] = [];
    for (const connection of connections.filter(connection => connection.installation && (!connectionId || connection.id === connectionId))) {
      const repositories = await send<{ full_name: string }[]>({ operation: 'repositories', id: connection.id });
      if (repositories.some(repo => repo.full_name.toLowerCase() === workspace.repository.toLowerCase())) matches.push(connection);
    }
    if (matches.length !== 1) throw Error('Workspace requires one explicit authorized storage connection; supply connectionId when discovery is ambiguous.');
    const connection = matches[0], reader = new WorkspaceReader(send as GitTransport, connection.id, workspace.repository, connection.installation!.id, workspace.workspace);
    // Discovery for execution does not read or restore the native task namespace.
    const refs = await send<GitRef[]>({ operation: 'gitRefs', id: connection.id, installationId: connection.installation!.id, repository: workspace.repository, prefix: 'documents/' });
    const documents = refs.find(ref => ref.ref === `refs/documents/${workspace.workspace}`)?.object.sha;
    if (!documents) throw Error('Selected workspace has no document manifest.');
    return { reader, ...(await reader.open({ name: workspace.workspace, documents })) };
  }
  const call = async (name: string, input: any) => {
    if (name === 'workflows_list') {
      const workspace = input.workspace ?? await currentWorkspace();
      const raw = await send<Record<string, any>>({ operation: 'workflowCatalog', ...(workspace ? { workspace: workspace.workspace } : {}) });
      const catalog = { ...raw, connections: raw.connections.map((connection: any) => ({ ...connection, connectionRef: JSON.stringify({ id: connection.id, installationId: connection.installationId, userId: connection.userId }) })) };
      if (!workspace) return { ...catalog, workspace: null, message: 'Select a conversation workspace or supply an explicit workspace to discover source members.' };
      try {
        const opened = await readerFor(scopeSchema.parse(workspace), input.connectionId);
        return { ...catalog, workspace, manifestVersion: opened.version, manifestSnapshot: opened.snapshot.commit, members: opened.manifest.repositories };
      } catch (error) { return { ...catalog, workspace, manifestState: 'unavailable', manifestError: error instanceof Error ? error.message : 'Manifest read failed.' }; }
    }
    const { connectionRef, ...args } = input, scope = z.object(workflowScope).strict().parse(JSON.parse(connectionRef));
    if (name === 'workflow_start') { await beforeLaunch(); return send({ operation: 'workflowStart', ...args, ...scope }); }
    const status = await send<Record<string, any>>({ operation: 'workflowStatus', ...args, ...scope });
    if (!status.runId || !status.attempt || !status.reportName) return status;
    const workspace = input.reportWorkspace ?? await currentWorkspace();
    if (!workspace || workspace.workspace !== status.workspace) return { ...status, reportState: 'select-original-workspace' };
    try {
      const opened = await readerFor(workspace, input.reportWorkspace?.connectionId);
      const entry = opened.snapshot.tree.tree.find(entry => entry.path === `documents/${status.reportName}`);
      if (!entry) return { ...status, reportState: 'not-yet-published' };
      if (entry.size === undefined || entry.size > 64 * 1024) throw Error('Workflow report exceeds 64 KiB.');
      const text = documentText(await opened.reader.blob(entry)), match = /\n## Result contract\n\n```json\n([^\n]+)\n```\n$/.exec(text);
      if (!match) throw Error('Report has no machine-readable result contract.');
      const result = workflowReportSchema.parse(JSON.parse(match[1]));
      if (result.workspace !== status.workspace || result.thread !== status.thread || result.process !== status.process || result.executionId !== `${status.runId}-${status.attempt}`) throw Error('Report does not match the exact execution.');
      const url = new URL('https://mickmister.github.io/github-ultimate/previews/b-vk-46e5-vd-multi-instanc-0940c2d95906d253/app/');
      url.hash = `/documents/${encodeURIComponent(`${entry.sha}:documents/${status.reportName}`)}?${new URLSearchParams({ repository: workspace.repository, workspace: workspace.workspace })}`;
      return { ...status, candidateAcceptance: result.status, result, report: { name: status.reportName, version: entry.sha, snapshot: opened.snapshot.commit, url: url.href } };
    } catch (error) { return { ...status, reportState: 'unavailable-or-invalid', reportError: error instanceof Error ? error.message : 'Report read failed.' }; }
  };
  return [{ name: 'codemode', label: 'Run workflow JavaScript', replay: 'never',
    description: 'Execute bounded JavaScript in QuickJS using these shared MCP capabilities: ' + JSON.stringify(workflowTools.map(({ name, description, schema }) => ({ name, description, inputSchema: z.toJSONSchema(schema) }))) + '. Use await tools.NAME(args) and text(value). No shell, fetch, imports, DOM or ambient credentials. Workflow launches are durable effects: script failure/cancellation cannot roll them back. Retain the execution reference and stable workspace/thread/process; never blindly replay or invent replacement identities.',
    parameters: obj({ code: str({ maxLength: 32 * 1024 }) }),
    execute: async (_id, input, signal) => { const { code } = z.object({ code: z.string().max(32 * 1024) }).strict().parse(input); return { content: [{ type: 'text', text: JSON.stringify(await executeWorkflowCode(code, call, signal)) }], details: undefined }; },
  }];
}
