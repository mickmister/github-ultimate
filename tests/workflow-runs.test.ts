import { expect, test, vi } from 'vitest';
import { WorkspaceRuns, parseObservabilityPointer, sortWorkspaceRuns } from '../hosted/workflow-runs';
import { actionsReadSchema, actionPath, actionResult, jobTiming } from '../src/actions-protocol';
import { decodeTelemetryArchive, tarMembers } from '../src/otel-tables';
import { archive, members, pointer, actionRun, workspaceFixture, connectionId, repository, s3Id, revision } from './fixtures/workflow-runs';

test('workspace membership is read before Actions and a shared run is not duplicated or inferred from branches', async () => {
  const calls: any[] = [];
  const send = vi.fn(async (r: any) => {
    calls.push(r); const f = workspaceFixture(r.workspace);
    if (r.operation === 'gitRefs') return r.prefix === 'documents/' ? ['workspace-a', 'workspace-b'].map(name => ({ ref: `refs/documents/${name}`, object: { sha: workspaceFixture(name).commit } })) : [];
    if (r.operation === 'gitCommit') return { sha: r.oid, tree: { sha: f.tree } };
    if (r.operation === 'gitTree') return { sha: r.oid, truncated: false, tree: f.entries };
    if (r.operation === 'gitBlob') return f.blobs[r.oid];
    if (r.operation === 'actionsRead') return actionRun(r.run, r.attempt);
    throw Error('Unexpected operation');
  });
  const runs = new WorkspaceRuns(send as any), base = { connectionId, repository: 'example/storage', installationId: 1 };
  expect((await runs.list({ ...base, workspace: 'workspace-a' })).runs.map(run => run.run)).toEqual([20, 10]);
  expect((await runs.list({ ...base, workspace: 'workspace-b' })).runs.map(run => run.run)).toEqual([20, 30]);
  expect(calls.filter(r => r.operation === 'actionsRead').map(r => r.run)).not.toContain(99);
  expect(calls.some(r => r.operation === 'actionsRead' && r.kind !== 'run')).toBe(false);
  expect(calls.findIndex(r => r.operation === 'actionsRead')).toBeGreaterThan(calls.findIndex(r => r.operation === 'gitBlob'));
});
test('pointer identity, exact attempt and typed broker paths reject substitutions', () => {
  const p = pointer(10), path = 'workflow-runs/github-10/observability/attempts/1/worker.json';
  expect(parseObservabilityPointer(JSON.stringify(p), path).github_run_id).toBe('10');
  expect(() => parseObservabilityPointer(JSON.stringify({ ...p, payload_key: '../other' }), path)).toThrow('identity');
  const input = actionsReadSchema.parse({ operation: 'actionsRead', id: connectionId, installationId: 1, repository, run: 10, attempt: 2, kind: 'jobs' });
  expect(actionPath(input)).toBe(`/repos/${repository}/actions/runs/10/attempts/2/jobs?per_page=100&page=1`);
  expect(() => actionResult({ ...input, kind: 'run' }, actionRun(10, 1))).toThrow('identity');
  expect(actionsReadSchema.safeParse({ ...input, repository: '../escape' }).success).toBe(false);
});
test('job-window timing differs from parallel job sums and does not invent missing completion', () => {
  const job = { id: 1, name: 'worker', status: 'completed', conclusion: 'success', started_at: '2026-11-18T00:00:00Z', completed_at: '2026-11-18T00:00:10Z' };
  expect(jobTiming([job, { ...job, id: 2 }])).toMatchObject({ milliseconds: 10000, summed: 20000 });
  expect(jobTiming([{ ...job, completed_at: null }]).milliseconds).toBeNull();
  expect(jobTiming([{ ...job, status: 'queued', started_at: null, completed_at: null }]).label).toBe('Not started');
});
test('independent OTLP golden wire yields exact IDs/timestamps/events/links and metric integer', async () => {
  const result = await decodeTelemetryArchive(archive, members, 'worker');
  expect(result.tables.spans.map(row => [row.name, row.duration_ms])).toEqual([['parent', 300], ['child', 100]]);
  expect(result.tables.spans[1]).toMatchObject({ trace_id: '01'.repeat(16), parent_span_id: '02'.repeat(8), span_id: '03'.repeat(8), status_code: 2, start_time_ns: '1700000000100000000', service_name: 'golden-agent' });
  expect(result.tables.span_events[0].name).toBe('checkpoint');
  expect(result.tables.span_links[0].record_json).toContain('traceId');
  expect(result.tables.metrics[0].point_json).toContain('"asInt":"42"');
  await expect(decodeTelemetryArchive(archive, [{ ...members[0], sha256: '0'.repeat(64) }, members[1]], 'worker')).rejects.toThrow('digest');
  await expect(decodeTelemetryArchive(archive, [members[0]], 'worker')).rejects.toThrow('inventory');
  expect(() => tarMembers(new Uint8Array(512).fill(255))).toThrow();
});

test('private S3 loading pins receipt to workspace association, uses selected revision and rejects modified payload bytes', async () => {
  const p = parseObservabilityPointer(JSON.stringify(pointer(10)), 'workflow-runs/github-10/observability/attempts/1/worker.json');
  const connection = { id: s3Id, revision, name: 'Private', endpoint: 'https://storage.example.test', region: 'us-east-1', bucket: p.bucket, prefix: 'pilot/', addressing: 'path' as const, allowRead: true, allowUpload: false, allowOverwrite: false, hostedGrants: [] };
  let corrupt = false;
  const send = vi.fn(async (request: any) => {
    expect(request.revision).toBe(revision); expect(request.id).toBe(s3Id);
    const data = request.key.endsWith('receipt.json') ? Buffer.from(JSON.stringify({ ...p, members })) : Buffer.from(corrupt ? new Uint8Array(archive.length) : archive);
    return { key: request.key, size: data.length, contentType: 'application/octet-stream', base64: data.toString('base64') };
  });
  const service = new WorkspaceRuns(send as any);
  expect((await service.readArchive(p, connection)).bytes.length).toBe(archive.length);
  corrupt = true; await expect(service.readArchive(p, connection)).rejects.toThrow('digest');
  const count = send.mock.calls.length;
  await expect(service.readArchive(p, { ...connection, bucket: 'other-private-bucket' })).rejects.toThrow('bucket');
  expect(send.mock.calls.length).toBe(count);
});

test('private output inventories reject receipts from a different attempt', async () => {
  const p = parseObservabilityPointer(JSON.stringify(pointer(10)), 'workflow-runs/github-10/observability/attempts/1/worker.json');
  const prefix = `pilot/workflow-files/github/${repository}/10-1/`, key = prefix + 'result/receipt.json';
  let attempt = '1';
  const send = vi.fn(async (request: any) => {
    if (request.operation === 's3List') { expect(request.prefix).toBe(prefix); return { objects: [{ key, size: 100 }] }; }
    const bytes = Buffer.from(JSON.stringify({ schema_version: 1, repository, github_run_id: '10', github_run_attempt: attempt, name: 'result', payload_key: `workflow-files/github/${repository}/10-1/result/payload.tgz`, bytes: 123, sha256: 'a'.repeat(64), members: [] }));
    return { key, size: bytes.length, base64: bytes.toString('base64') };
  });
  const service = new WorkspaceRuns(send as any), connection = { id: s3Id, revision, bucket: p.bucket, prefix: 'pilot/', allowRead: true } as any;
  expect(await service.outputs(p, connection)).toMatchObject([{ name: 'result', bytes: 123 }]);
  attempt = '2'; await expect(service.outputs(p, connection)).rejects.toThrow();
});
