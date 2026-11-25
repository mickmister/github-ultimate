import { expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { readWorkflowProgress } from '../src/workflow-progress';
import { reviewRequestSchema } from '../src/review-protocol';

const delivery = { executionReference: 'a6075abf-226e-4c88-977c-e11404e59f32', digest: 'd'.repeat(64), engineCommit: 'a'.repeat(40),
  workspace: 'workspace', thread: 'thread', process: 'process', userId: 1, installationId: 2, attemptedAt: '2026-11-25T00:00:00Z', state: 'dispatched' as const };
const progress = { schemaVersion: 1, workspace: 'workspace', thread: 'thread', process: 'process', executionId: '123-1', updatedAt: '2026-11-25T00:01:00Z',
  currentStep: 'evaluate', nextStep: 'collect-evaluations', cycle: 1, maxCycles: 4, roles: [{ role: 'tester', status: 'running' }], delivery: 'pending', analysis: 'pending' };
const external = 'pi-development:' + createHash('sha256').update(JSON.stringify(['workspace', 'thread', 'process', '123-1'])).digest('hex');
const check = () => ({ head_sha: delivery.engineCommit, external_id: external, app: { slug: 'github-actions' }, output: { text: '```json\n' + JSON.stringify(progress) + '\n```' } });

test('workflow progress binds engine, conversation identity and attempt; Actions steps retain actual states', async () => {
  const paths: string[] = [];
  const result = await readWorkflowProgress(delivery, { id: 123, run_attempt: 1 }, async path => {
    paths.push(path);
    return path.includes('/jobs?') ? { total_count: 2, jobs: [{ id: 4, name: 'Development', status: 'in_progress', conclusion: null, started_at: progress.updatedAt, completed_at: null,
      steps: [{ number: 1, name: 'Setup', status: 'completed', conclusion: 'success' }, { number: 2, name: 'Work', status: 'in_progress', conclusion: null }] }] } : { check_runs: [check()] };
  });
  expect(result.progress).toEqual(progress); expect(result.jobsPartial).toBe(true);
  expect(result.jobs?.[0].steps?.[1].status).toBe('in_progress');
  expect(paths.some(path => path.includes('/attempts/1/jobs?'))).toBe(true);
});

test('foreign check apps, duplicate matches and wrong attempts never become workflow progress', async () => {
  for (const checks of [[{ ...check(), app: { slug: 'other-app' } }], [check(), check()], [{ ...check(), output: { text: '```json\n' + JSON.stringify({ ...progress, executionId: '123-2' }) + '\n```' } }]]) {
    const result = await readWorkflowProgress(delivery, { id: 123, run_attempt: 1 }, async path => path.includes('/jobs?') ? { total_count: 0, jobs: [] } : { check_runs: checks });
    expect(result.progress).toBeUndefined(); expect(result.progressState).toBe('unavailable-or-unconfirmed');
  }
});

test('revoked progress access preserves independent job status without leaking transport errors', async () => {
  const result = await readWorkflowProgress(delivery, { id: 123, run_attempt: 1 }, async path => {
    if (path.includes('/jobs?')) return { total_count: 0, jobs: [] };
    throw Error('PRIVATE auth error');
  });
  expect(result.jobs).toEqual([]); expect(result.progress).toBeUndefined(); expect(JSON.stringify(result)).not.toContain('PRIVATE');
});

test('execution-owned review is tracker-free while legacy Bead/thread ownership remains strict', () => {
  const request = { kind: 'review-request', schema_version: 2, request_id: 'delivery-review', revision_id: 'revision-1', workspace: 'workspace',
    execution: { kind: 'development', id: '123-1', process: 'process', thread_id: 'thread' }, thread: 'threads/thread', title: 'Changes', purpose: 'Inspect delivery', question: 'Any findings?',
    status: 'published', change_kind: 'implemented', members: [{ kind: 'document', id: 'delivery', label: 'Changes and analysis', target: { resource: 'threads/thread/delivery.md', version_kind: 'git-blob', version: 'b'.repeat(40), snapshot: 'c'.repeat(40) } }] };
  expect(reviewRequestSchema.parse(request).bead_id).toBeUndefined();
  expect(reviewRequestSchema.safeParse({ ...request, thread: 'threads/other' }).success).toBe(false);
  expect(reviewRequestSchema.safeParse({ ...request, bead_id: 'fake-bead' }).success).toBe(false);
  expect(reviewRequestSchema.safeParse({ ...request, schema_version: 1, execution: undefined }).success).toBe(false);
  expect(reviewRequestSchema.safeParse({ ...request, schema_version: 1, execution: undefined, bead_id: 'thread' }).success).toBe(true);
});
