import { createHash } from 'node:crypto';
import { gzipSync } from 'fflate';

// Independent wire encoder: do NOT use the production decoder schema to produce
// the golden trace. Wrong production field numbers must break this fixture.
const join = (...arrays: Uint8Array[]) => Buffer.concat(arrays);
function varint(value: number) { const bytes: number[] = []; do { const byte = value & 127; value = Math.floor(value / 128); bytes.push(byte | (value ? 128 : 0)); } while (value); return Buffer.from(bytes); }
const field = (number: number, data: Uint8Array) => join(varint(number * 8 + 2), varint(data.length), data);
const text = (number: number, value: string) => field(number, Buffer.from(value));
const integer = (number: number, value: number) => join(varint(number * 8), varint(value));
function time(number: number, ns: bigint) { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(ns); return join(varint(number * 8 + 1), bytes); }
const attribute = (key: string, value: string) => join(text(1, key), field(2, text(1, value)));
export const traceId = Buffer.alloc(16, 1), parentId = Buffer.alloc(8, 2), childId = Buffer.alloc(8, 3);
export const goldenTraces = field(1, join(
  field(1, field(1, attribute('service.name', 'golden-agent'))),
  field(2, join(field(1, text(1, 'independent-fixture')), field(2, join(field(1, traceId), field(2, parentId), text(5, 'parent'), time(7, 1700000000000000000n), time(8, 1700000000300000000n))),
    field(2, join(field(1, traceId), field(2, childId), field(4, parentId), text(5, 'child'), time(7, 1700000000100000000n), time(8, 1700000000200000000n),
      field(11, join(time(1, 1700000000150000000n), text(2, 'checkpoint'))), field(13, join(field(1, traceId), field(2, parentId))), field(15, integer(3, 2))))))));
export const goldenMetrics = field(1, field(2, field(2, join(text(1, 'tokens'), text(3, 'count'), field(7, join(field(1, join(time(3, 1700000000000000000n), join(varint(6 * 8 + 1), Buffer.from([42, 0, 0, 0, 0, 0, 0, 0])))), integer(2, 2), integer(3, 1)))))));
export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function tar(files: Record<string, Uint8Array>) {
  const blocks: Buffer[] = [];
  for (const [name, data] of Object.entries(files)) {
    const header = Buffer.alloc(512); header.write(name, 0); header.write('0000600\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124); header.write('00000000000\0', 136); header.fill(32, 148, 156); header[156] = 48; header.write('ustar\0', 257); header.write('00', 263);
    header.write([...header].reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(header, Buffer.from(data), Buffer.alloc((512 - data.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
const wrap = (data: Uint8Array) => join(Buffer.from('application/x-protobuf\n\n'), data);
export const goldenFiles = { 'otel/1.traces': wrap(goldenTraces), 'otel/2.metrics': wrap(goldenMetrics) };
export const archive = tar(goldenFiles);
export const members = Object.entries(goldenFiles).map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: sha256(bytes) }));
export const connectionId = '11111111-1111-4111-8111-111111111111';
export const s3Id = '22222222-2222-4222-8222-222222222222';
export const revision = '33333333-3333-4333-8333-333333333333';
export const repository = 'example/gh-agentic-workflows';
export function pointer(run: number, attempt = 1, workspaceRef = 'ws-' + 'a'.repeat(32)) { return {
  schema_version: 1, repository, github_run_id: String(run), github_run_attempt: String(attempt), github_job_instance: 'worker',
  workspace_ref: workspaceRef, association: 'execution-used-workspace', payload_key: `observability/github/${repository}/${run}-${attempt}/worker/payload.tgz`, sha256: sha256(archive), bytes: archive.length, verified: true, bucket: 'private-telemetry', prefix: 'pilot',
}; }
export function actionRun(run: number, attempt = 1) { return { id: run, run_attempt: attempt, name: 'Agent work', display_title: `Fixture run ${run}`, created_at: run === 20 ? '2026-11-18T01:00:00Z' : '2026-11-18T00:00:00Z', run_started_at: '2026-11-18T01:00:00Z', status: 'completed', conclusion: 'success', head_sha: 'b'.repeat(40), head_branch: 'feature/shared', html_url: `https://github.com/${repository}/actions/runs/${run}` }; }
export function workspaceFixture(workspace = 'workspace-a') {
  const commit = (workspace === 'workspace-a' ? 'a' : 'b').repeat(40), tree = (workspace === 'workspace-a' ? 'c' : 'd').repeat(40);
  const files: Record<string, string> = { 'workspace/manifest.json': JSON.stringify({ schema_version: 1, workspace, observed_at: '2026-11-18T00:00:00Z', purpose: 'Independent run browser fixture' }) };
  const request = JSON.stringify({ kind: 'review-request', schema_version: 1, request_id: 'golden-review', revision_id: 'golden-v1', workspace, bead_id: 'task-golden', related_beads: [], thread: 'threads/task-golden', title: 'Exact golden review', purpose: 'Check exact output revision', question: 'Review the evidence', status: 'published', change_kind: 'proposal', members: [{ id: 'doc', kind: 'document', label: 'Golden result', target: { resource: 'threads/task-golden/result.md', version_kind: 'git-blob', version: 'd'.repeat(40), snapshot: commit } }] });
  const reviewVersion = createHash('sha1').update(`blob ${Buffer.byteLength(request)}\0`).update(request).digest('hex');
  files['review-requests/golden-review/request.json'] = request;
  const runIDs = workspace === 'workspace-a' ? [10, 20] : [20, 30];
  for (const run of runIDs) files[`workflow-runs/github-${run}/observability/attempts/1/worker.json`] = JSON.stringify({ ...pointer(run, 1, 'ws-' + (workspace === 'workspace-a' ? 'a' : 'b').repeat(32)), related_reviews: [{ relation: 'produced-review-request', request: { resource: 'review-requests/golden-review/request.json', version_kind: 'git-blob', version: reviewVersion, snapshot: commit } }] });
  const blobs: Record<string, { sha: string; size: number; encoding: string; content: string }> = {};
  const entries = Object.entries(files).map(([name, value]) => { const bytes = Buffer.from(value), sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'); blobs[sha] = { sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') }; return { path: `documents/${name}`, mode: '100644', type: 'blob', sha, size: bytes.length }; });
  return { commit, tree, entries, blobs };
}
