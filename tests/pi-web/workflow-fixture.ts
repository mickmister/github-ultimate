import { createHash } from 'node:crypto';
import { Connections } from '../../src/connections';
import { MobileGitHub } from '../../src/mobile-github';
import { developmentHost, workflowRunName } from '../../src/workflow-interface';
import { previewFixture } from './preview-fixture';

export function workflowFixture(source: string) {
  const preview = previewFixture(source), record = preview.record;
  const execution = { executionReference: crypto.randomUUID(), digest: 'd'.repeat(64), workspace: preview.workspace, thread: 'conversation', process: 'feature-work', engineCommit: 'a'.repeat(40),
    userId: 1, installationId: 7, attemptedAt: new Date(Date.now() - 60000).toISOString(), state: 'dispatched' as const, runId: 123, connectionId: record.id, storageRepository: preview.navigation.repository };
  record.workflowDeliveries = { retained: execution };
  let completed = false, polls = 0;
  const external = 'pi-development:' + createHash('sha256').update(JSON.stringify([execution.workspace, execution.thread, execution.process, '123-1'])).digest('hex');
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/user/installations') return Response.json({ installations: [{ id: 7, app_id: 123, account: { login: 'owner' }, permissions: { actions: 'write', checks: 'read', contents: 'read' } }] });
    if (url.pathname === '/user/installations/7/repositories') return Response.json({ repositories: [{ full_name: preview.navigation.repository, private: true, default_branch: 'main' }, { full_name: developmentHost.repository, private: false, default_branch: developmentHost.ref }] });
    if (url.pathname.endsWith('/actions/runs/123')) {
      polls++;
      return Response.json({ id: 123, run_attempt: 1, display_title: workflowRunName(execution), event: 'workflow_dispatch', head_sha: execution.engineCommit,
        head_branch: developmentHost.ref, actor: { id: 1 }, created_at: execution.attemptedAt, run_started_at: execution.attemptedAt, status: completed ? 'completed' : 'in_progress', conclusion: completed ? 'success' : null });
    }
    if (url.pathname.endsWith('/attempts/1/jobs')) return Response.json({ total_count: 1, jobs: [{ id: 9, name: 'Development', status: completed ? 'completed' : 'in_progress', conclusion: completed ? 'success' : null,
      started_at: execution.attemptedAt, completed_at: completed ? new Date().toISOString() : null,
      steps: Array.from({ length: 8 }, (_, i) => ({ number: i + 1, name: `Step ${i + 1}`, status: completed || i < 2 ? 'completed' : i === 2 ? 'in_progress' : 'queued', conclusion: completed || i < 2 ? 'success' : null })) }] });
    if (url.pathname.endsWith(`/commits/${execution.engineCommit}/check-runs`)) return Response.json({ check_runs: [{ external_id: external, head_sha: execution.engineCommit, app: { slug: 'github-actions' }, output: { text: '```json\n' + JSON.stringify({ schemaVersion: 1, workspace: execution.workspace, thread: execution.thread, process: execution.process, executionId: '123-1', updatedAt: new Date().toISOString(),
      currentStep: completed ? 'analysis-complete' : 'evaluate', nextStep: completed ? 'human-review' : 'collect-evaluations', cycle: 1, maxCycles: 4, roles: [{ role: 'tester', status: completed ? 'completed' : 'running' }], delivery: completed ? 'delivered' : 'pending', analysis: completed ? 'complete' : 'pending' }) + '\n```' } }] });
    return preview.fetcher(input, init);
  };
  const store = { all: async () => [record], get: async () => record, put: async () => {}, remove: async () => {} };
  return { host: new MobileGitHub(new Connections(store, fetcher)), execution, complete() { completed = true; }, polls: () => polls };
}
