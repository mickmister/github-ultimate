import { expect, it } from 'vitest';
import { aggregateCi, readCommitCi } from '../src/commit-ci';
import { Connections, type ConnectionRecord } from '../src/connections';
import { workflowNeedsRefresh } from '../hosted/pi-chat-contract';

const sha = 'a'.repeat(40);
const check = { id: 1, name: 'Build', head_sha: sha, status: 'completed', conclusion: 'success' };
const run = { id: 42, workflow_id: 7, head_sha: sha, head_branch: 'main', event: 'push', name: 'Release', status: 'completed', conclusion: 'failure' };
it('resolves a branch once and catches a failed release even when commit checks pass', async () => {
  const paths: string[] = [];
  const result = await readCommitCi('owner/repo', 'refs/heads/main', async path => {
    paths.push(path);
    if (path === '/commits/refs%2Fheads%2Fmain') return { sha };
    if (path.includes('/check-runs')) return { total_count: 1, check_runs: [check] };
    if (path.includes('/status?')) return { total_count: 0, statuses: [] };
    return { total_count: 1, workflow_runs: [run] };
  });
  expect(result.state).toBe('failure'); expect(result.sha).toBe(sha);
  expect(result.checks.find(item => item.name === 'Release')?.url).toBe('https://github.com/owner/repo/actions/runs/42');
  expect(paths.filter(path => path.includes('refs%2Fheads'))).toHaveLength(1);
  expect(paths.slice(1).every(path => path.includes(sha))).toBe(true);
});
it('reports partial permissions as unknown and does not turn no CI into success', async () => {
  const empty = await readCommitCi('owner/repo', sha, async path => path.includes('check-runs') ? { check_runs: [] } : path.includes('/status?') ? { statuses: [] } : { workflow_runs: [] });
  expect(empty.state).toBe('none');
  expect(aggregateCi(['success', 'none'])).toBe('unknown');
  expect(aggregateCi(['none'])).toBe('none');
  const denied = await readCommitCi('owner/repo', sha, async path => {
    if (path.includes('/actions/')) throw Error('Forbidden');
    return path.includes('check-runs') ? { check_runs: [check] } : { statuses: [] };
  });
  expect(denied.state).toBe('unknown'); expect(denied.partial).toBe(true);
});
it('authorizes CI repository and installation reads at the host boundary', async () => {
  const record: ConnectionRecord = { id: crypto.randomUUID(), name: 'GitHub', appId: 123, clientId: 'client', user: { id: 1, login: 'owner' }, installation: { id: 7, account: 'owner' }, tokens: { accessToken: 'private-token', expiresAt: Date.now() + 3600000 }, hostedGrants: [{ origin: 'https://example.test', subpath: '/app/' }] };
  let reads = 0;
  const host = new Connections({ all: async () => [record], get: async () => record, put: async () => {}, remove: async () => {} }, async input => {
    const url = String(input);
    if (url.includes('/user/installations?')) return Response.json({ installations: [{ id: 7, app_id: 123, account: { login: 'owner' }, permissions: { contents: 'read' } }] });
    if (url.includes('/repositories?')) return Response.json({ repositories: [{ full_name: 'owner/repo', default_branch: 'main', private: true }] });
    reads++;
    return Response.json(url.includes('check-runs') ? { check_runs: [] } : url.includes('/status?') ? { statuses: [] } : { workflow_runs: [] });
  });
  const request = { operation: 'commitCi', id: record.id, installationId: 7, repository: 'owner/repo', ref: sha };
  for (const bad of [{ ...request, repository: 'other/private' }, { ...request, installationId: 8 }]) await expect(host.handleHosted('https://example.test/app/', bad)).rejects.toThrow();
  await expect(host.handleHosted('https://example.test/elsewhere/', request)).rejects.toThrow();
  expect(reads).toBe(0);
  expect(await host.handleHosted('https://example.test/app/', request)).toMatchObject({ sha, state: 'none' });
  expect(reads).toBe(3);
});
it('uses the newest run/context without hiding other failing workflows', async () => {
  const result = await readCommitCi('owner/repo', sha, async path => path.includes('check-runs') ? { check_runs: [] } : path.includes('/status?') ? { statuses: [
    { context: 'external', state: 'success' }, { context: 'external', state: 'failure' },
  ] } : { workflow_runs: [{ ...run, id: 43, conclusion: 'success' }, run, { ...run, id: 44, workflow_id: 8, name: 'Deploy' }] });
  expect(result.checks.map(item => item.detail)).toEqual(['success', 'success', 'failure']);
  expect(result.state).toBe('failure');
});
it('reads later check pages and rejects foreign commit observations', async () => {
  const paged = await readCommitCi('owner/repo', sha, async path => {
    if (path.includes('check-runs')) return { total_count: 101, check_runs: path.endsWith('page=1') ? Array.from({ length: 100 }, (_, id) => ({ ...check, id })) : [{ ...check, id: 101, conclusion: 'failure' }] };
    return path.includes('/status?') ? { statuses: [] } : { workflow_runs: [] };
  });
  expect(paged.state).toBe('failure'); expect(paged.checks).toHaveLength(101);
  const foreign = await readCommitCi('owner/repo', sha, async path => path.includes('check-runs') ? { check_runs: [{ ...check, head_sha: 'b'.repeat(40) }] } : path.includes('/status?') ? { statuses: [] } : { workflow_runs: [] });
  expect(foreign.state).toBe('unknown'); expect(foreign.partial).toBe(true);
});
it('continues source CI polling after the development run finishes', () => {
  const workflow: any = { observation: { executionState: 'completed', result: { delivery: { status: 'delivered' } }, sourceCi: { state: 'pending' } } };
  expect(workflowNeedsRefresh(workflow)).toBe(true);
  workflow.observation.sourceCi.state = 'success'; expect(workflowNeedsRefresh(workflow)).toBe(false);
  workflow.observation.sourceCi.state = 'none'; expect(workflowNeedsRefresh(workflow)).toBe(true);
});
