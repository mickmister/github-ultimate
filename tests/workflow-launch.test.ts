import { expect, test } from 'vitest';
import { Connections, type ConnectionRecord, type ConnectionStore } from '../src/connections';
import { developmentHost, workflowReportSchema, workflowRunName } from '../src/workflow-interface';

function fixture(lost = false) {
  const id = crypto.randomUUID(), userId = 6913320, installationId = 7, engineCommit = 'a'.repeat(40);
  let record: ConnectionRecord = { id, name: 'GitHub', appId: 123, clientId: 'client', user: { id: userId, login: 'owner' }, installation: { id: installationId, account: 'owner' }, tokens: { accessToken: 'private-token', expiresAt: Date.now() + 3600000 }, hostedGrants: [{ origin: 'https://example.test', subpath: '/app/' }] };
  const store: ConnectionStore = { all: async () => [structuredClone(record)], get: async () => structuredClone(record), put: async value => { record = structuredClone(value); }, remove: async () => {} };
  let writes = 0, permissions = 'write'; const bodies: any[] = [], runs: any[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/user/installations?')) return Response.json({ installations: [{ id: installationId, app_id: 123, account: { login: 'owner' }, permissions: { actions: permissions, contents: 'read' } }] });
    if (url.includes(`/user/installations/${installationId}/repositories?`)) return Response.json({ repositories: [{ full_name: developmentHost.repository, private: false, default_branch: developmentHost.ref }] });
    if (url.includes('/commits/')) return Response.json({ sha: engineCommit });
    if (url.endsWith('/dispatches')) {
      expect(Object.values(record.workflowDeliveries ?? {})).toHaveLength(1);
      expect(Object.values(record.workflowDeliveries!)[0].state).toBe('dispatch-unknown');
      writes++; bodies.push(JSON.parse(String(init?.body)));
      if (lost) throw Error('POST response lost');
      return new Response(null, { status: 204 });
    }
    if (url.includes('/runs?')) return Response.json({ workflow_runs: runs });
    if (url.endsWith('/actions/runs/42')) return Response.json(runs[0]);
    throw Error(`Unexpected route ${url}`);
  };
  const broker = new Connections(store, fetcher), scope = { id, installationId, userId }, page = 'https://example.test/app/';
  const request = { operation: 'workflowStart', ...scope, workspace: 'workspace', allowSourceEffects: true, request: { schemaVersion: 2, thread: 'conversation', process: 'request-1', member: 'app', baseCommit: 'b'.repeat(40), task: 'Fix the source', acceptanceCriteria: ['Required checks pass'], publishCandidate: false } };
  return { broker, store, scope, page, request, bodies, runs, engineCommit, writes: () => writes, readonly() { permissions = 'read'; }, run() { const delivery = Object.values(record.workflowDeliveries!)[0]; return { id: 42, run_attempt: 1, display_title: workflowRunName(delivery), event: 'workflow_dispatch', head_branch: developmentHost.ref, head_sha: engineCommit, actor: { id: userId }, created_at: delivery.attemptedAt, status: 'completed', conclusion: 'success' }; } };
}

test('launch persists intent before POST, serializes repeats and binds immutable engine inputs', async () => {
  const f = fixture();
  const [first, repeat] = await Promise.all([f.broker.handleHosted(f.page, f.request), f.broker.handleHosted(f.page, f.request)]) as any[];
  expect(first).toEqual(repeat); expect(f.writes()).toBe(1);
  expect(f.bodies[0].inputs).toMatchObject({ 'engine-commit': f.engineCommit, 'allow-source-effects': 'true' });
  expect(JSON.parse(f.bodies[0].inputs.request)).not.toHaveProperty('bead');
  expect(JSON.parse(f.bodies[0].inputs.request)).not.toHaveProperty('testCommands');
  await expect(f.broker.handleHosted(f.page, { ...f.request, request: { ...f.request.request, task: 'Different work' } })).rejects.toThrow('different inputs');
  f.runs.push(f.run());
  const status = await f.broker.handleHosted(f.page, { operation: 'workflowStatus', ...f.scope, executionReference: first.executionReference });
  expect(status).toMatchObject({ runId: 42, executionState: 'completed', candidateAcceptance: 'unknown-until-bound-report' });
  expect(f.writes()).toBe(1);
});

test('lost dispatch response survives host restart and cannot be blindly replayed', async () => {
  const f = fixture(true), first: any = await f.broker.handleHosted(f.page, f.request);
  expect(first.state).toBe('dispatch-unknown');
  const restarted = new Connections(f.store, async () => { throw Error('Repeated launch must not call the network'); });
  // Authenticated preflight still reads permission metadata; the original host
  // demonstrates the same persisted identity cannot issue another POST.
  expect(await f.broker.handleHosted(f.page, f.request)).toEqual(first);
  const catalog: any = await f.broker.handleHosted(f.page, { operation: 'workflowCatalog', workspace: 'workspace' });
  expect(catalog.connections[0].executions[0].executionReference).toBe(first.executionReference);
  expect(await restarted.handleHosted(f.page, { operation: 'workflowCatalog', workspace: 'workspace' })).toMatchObject({ connections: [{ executions: [first] }] });
  expect(await restarted.handleHosted(f.page, { operation: 'workflowCatalog', workspace: 'other' })).toMatchObject({ connections: [{ executions: [] }] });
  expect(f.writes()).toBe(1);
  f.runs.push({ ...f.run(), actor: { id: 999 } });
  expect(await f.broker.handleHosted(f.page, { operation: 'workflowStatus', ...f.scope, executionReference: first.executionReference })).toMatchObject({ executionState: 'unconfirmed' });
  f.runs.splice(0, 1, f.run(), f.run());
  expect(await f.broker.handleHosted(f.page, { operation: 'workflowStatus', ...f.scope, executionReference: first.executionReference })).toMatchObject({ executionState: 'ambiguous' });
  expect(f.writes()).toBe(1);
});

test('launch refuses wrong origin, changed identity, command payloads and read-only installation', async () => {
  const f = fixture();
  for (const input of [{ ...f.request, userId: 9 }, { ...f.request, installationId: 9 }, { ...f.request, allowSourceEffects: false }, { ...f.request, request: { ...f.request.request, testCommands: [['true']] } }, { ...f.request, repository: 'attacker/repo' }]) await expect(Promise.resolve().then(() => f.broker.handleHosted(f.page, input))).rejects.toThrow();
  await expect(f.broker.handleHosted('https://example.test/elsewhere/', f.request)).rejects.toThrow('approved');
  f.readonly(); await expect(f.broker.handleHosted(f.page, f.request)).rejects.toThrow('write permission');
  expect(f.writes()).toBe(0);
});

test('result acceptance requires exact candidate approvals and passing required checks', () => {
  const candidate = 'b'.repeat(40), report = { schemaVersion: 1, workspace: 'workspace', thread: 'conversation', process: 'request-1', executionId: '42-1', status: 'accepted', currentStep: 'candidate-accepted', nextStep: 'human-review-candidate', cycle: 1, candidate, testsPassed: true, evaluations: ['reviewer-1', 'reviewer-2', 'tester'].map(role => ({ role, candidate, approval: 'approve' })) };
  expect(workflowReportSchema.parse(report).status).toBe('accepted');
  for (const patch of [{ testsPassed: false }, { evaluations: report.evaluations.slice(0, 2) }, { evaluations: [report.evaluations[0], report.evaluations[0], report.evaluations[2]] }, { evaluations: report.evaluations.map(e => ({ ...e, candidate: 'c'.repeat(40) })) }]) expect(() => workflowReportSchema.parse({ ...report, ...patch })).toThrow();
});
