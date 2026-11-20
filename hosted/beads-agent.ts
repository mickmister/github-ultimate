import type { AgentTool } from '@earendil-works/pi-agent-core';
import { obj, str, opt, oneOf, int } from '@earendil-works/pi-schema';
import { z } from 'zod';
import { openBeadsSample, type BeadsSession, type BeadsOperation, type BeadsScope, type BeadsPin } from './beads-sample';
import type { PiBridge } from './pi-transport';

const input = z.object({ operation: z.enum(['list', 'show', 'ready', 'blocked', 'refresh']), id: z.string().max(200).optional(), query: z.string().max(200).optional(), status: z.string().max(100).optional(), assignee: z.string().max(200).optional(), label: z.string().max(200).optional(), type: z.string().max(100).optional(), offset: z.number().int().min(0).max(100000).default(0), limit: z.number().int().min(1).max(50).default(20) }).strict();
export function beadsAgent(scope: BeadsScope | undefined, userId: number, send: PiBridge, open = openBeadsSample, pinned?: BeadsPin) {
  let session: BeadsSession | undefined, loading: Promise<BeadsSession> | undefined;
  let controller = new AbortController(), disposed = false;
  const cache = new Map<BeadsOperation, Record<string, unknown>[]>();
  const tool: AgentTool = {
    name: 'beads_query', label: 'Read workspace Beads', replay: 'safe',
    description: 'Read the same selected published workspace as Kanban. Operations: list/show/ready/blocked; refresh explicitly reloads the latest published snapshot. TypeScript filtering over native results; no writes. query searches ID/title/description/notes. Results carry snapshot identity and bounded pages. show requires an exact id. No CLI or SQL.',
    parameters: obj({ operation: oneOf(['list', 'show', 'ready', 'blocked', 'refresh']), id: opt(str({ maxLength: 200 })), query: opt(str({ maxLength: 200 })), status: opt(str({ maxLength: 100 })), assignee: opt(str({ maxLength: 200 })), label: opt(str({ maxLength: 200 })), type: opt(str({ maxLength: 100 })), offset: opt(int({ minimum: 0, maximum: 100000 })), limit: opt(int({ minimum: 1, maximum: 50 })) }),
    execute: async (_id, args, signal) => {
      const request = input.parse(args); signal?.throwIfAborted();
      if (disposed) throw Error('Beads session is closed.');
      if (controller.signal.aborted) { session?.dispose(); session = undefined; loading = undefined; cache.clear(); controller = new AbortController(); }
      const abort = () => { if (session) pinned = { gitCommit: session.gitCommit, doltCommit: session.doltCommit, ...(session.servingCommit ? { servingCommit: session.servingCommit } : {}) }; controller.abort(); };
      signal?.addEventListener('abort', abort, { once: true });
      try {
      if (!scope?.workspace) throw Error('Open Agent from the selected workspace to query its Beads.');
      const repositories = await send<{ full_name: string }[]>({ operation: 'agentRepositories', id: scope.connectionId, installationId: scope.installationId, userId });
      if (!repositories.some(r => r.full_name.toLowerCase() === scope.repository.toLowerCase())) throw Error('Selected Beads storage repository is unavailable.');
      signal?.throwIfAborted();
      if (request.operation === 'refresh') { session?.dispose(); session = undefined; loading = undefined; pinned = undefined; cache.clear(); }
      if (!session) {
        loading ??= open(scope, controller.signal, () => {}, send, pinned).catch(error => { loading = undefined; throw error; });
        const opened = await loading;
        if (signal?.aborted || controller.signal.aborted) { opened.dispose(); signal?.throwIfAborted(); controller.signal.throwIfAborted(); }
        session = opened;
        const state = await session.state();
        if (!state.putRejected || !state.commitRejected || !state.sealed) { session.dispose(); session = undefined; loading = undefined; throw Error('Beads engine did not open a sealed read-only snapshot.'); }
      }
      signal?.throwIfAborted(); controller.signal.throwIfAborted();
      const identity = { workspace: scope.workspace, repository: scope.repository, gitCommit: session.gitCommit, doltCommit: session.doltCommit };
      let value: unknown;
      if (request.operation === 'refresh') value = { ...identity, refreshed: true };
      else {
        const operation = request.operation === 'show' ? 'list' : request.operation;
        let issues = cache.get(operation);
        if (!issues) { issues = (await session.query(operation)).issues ?? []; cache.set(operation, issues); }
        if (request.operation === 'show' && !request.id) throw Error('show requires an exact issue id.');
        const query = request.query?.toLocaleLowerCase();
        const filtered = issues.filter(issue => (!request.id || issue.id === request.id) && (!query || [issue.id, issue.title, issue.description, issue.notes].some(v => typeof v === 'string' && v.toLocaleLowerCase().includes(query))) && (!request.status || issue.status === request.status) && (!request.assignee || issue.assignee === request.assignee) && (!request.type || issue.issue_type === request.type) && (!request.label || Array.isArray(issue.labels) && issue.labels.includes(request.label)))
          .sort((a, b) => Number(a.priority ?? 9) - Number(b.priority ?? 9) || String(a.id).localeCompare(String(b.id)));
        if (request.operation === 'show' && filtered.length !== 1) throw Error(filtered.length ? 'Issue ID is ambiguous.' : 'Issue not found in this snapshot.');
        let remaining = 28000;
        const selected: Record<string, unknown>[] = [];
        for (const issue of filtered.slice(request.offset, request.offset + (request.operation === 'show' ? 1 : request.limit))) {
          const fields = request.operation === 'show' ? ['id', 'title', 'status', 'priority', 'issue_type', 'assignee', 'labels', 'description', 'notes', 'design', 'acceptance_criteria', 'created_at', 'updated_at', 'closed_at'] : ['id', 'title', 'status', 'priority', 'issue_type', 'assignee', 'labels'];
          const row = Object.fromEntries(fields.filter(k => issue[k] !== undefined).map(k => [k, issue[k]]));
          const encoded = JSON.stringify(row);
          if (encoded.length > remaining) { if (!selected.length) selected.push({ id: issue.id, detailText: encoded.slice(0, remaining), truncated: true }); break; }
          remaining -= encoded.length; selected.push(row);
        }
        const next = request.offset + selected.length;
        value = { ...identity, issues: selected, total: filtered.length, ...(next < filtered.length ? { nextOffset: next } : {}), complete: next === filtered.length && !selected.some(row => row.truncated) };
      }
      signal?.throwIfAborted(); controller.signal.throwIfAborted();
      return { content: [{ type: 'text', text: JSON.stringify(value) }], details: undefined };
      } finally { signal?.removeEventListener('abort', abort); }
    },
  };
  return { tool, snapshot(): BeadsPin | undefined { return session ? { gitCommit: session.gitCommit, doltCommit: session.doltCommit, ...(session.servingCommit ? { servingCommit: session.servingCommit } : {}) } : pinned; }, dispose() { disposed = true; controller.abort(); session?.dispose(); } };
}
