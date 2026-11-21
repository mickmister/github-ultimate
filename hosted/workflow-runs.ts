import { z } from 'zod';
import { WorkspaceReader, documents, documentText } from './workspaces';
import type { WorkspaceScope } from '../webapp/src/app-hooks/contracts';
import { bridgeRequest } from './client';
import { reviewPinSchema, type ReviewPin } from '../src/review-protocol';
import { ReviewReader } from './reviews';
import type { ActionRun, ActionJob, ActionArtifact } from '../src/actions-protocol';
import type { PublicS3Connection, S3Object, S3Listing } from '../src/s3-protocol';
import { s3Key } from '../src/s3-protocol';

const decimal = z.string().regex(/^[1-9]\d{0,15}$/).refine(value => Number.isSafeInteger(Number(value)));
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const observabilityPointerSchema = z.object({
  schema_version: z.literal(1), repository: z.string().regex(/^[\w.-]+\/gh-agentic-workflows$/i),
  github_run_id: decimal, github_run_attempt: decimal, github_job_instance: z.string().regex(/^[\w-]+$/),
  workspace_ref: z.string().regex(/^ws-[a-f0-9]{32}$/), association: z.literal('execution-used-workspace'),
  payload_key: z.string(), sha256: digest, bytes: z.number().int().positive().max(256 * 1024 * 1024), verified: z.literal(true),
  bucket: z.string(), prefix: z.string(), captured_at_unix: z.number().optional(),
  related_reviews: z.array(z.object({ relation: z.enum(['triggered-by-response', 'produced-review-request', 'same-execution']), request: reviewPinSchema })).max(100).optional(),
}).passthrough();
export type ObservabilityPointer = z.infer<typeof observabilityPointerSchema>;
export interface RunAssociation { key: string; repository: string; run: number; attempt: number; pointers: ObservabilityPointer[]; sources: ReviewPin[]; task?: string }
export interface WorkspaceRun extends RunAssociation { metadata?: ActionRun; error?: string }
export interface RunInventory { snapshot: string; workspaceRef?: string; runs: WorkspaceRun[]; notices: string[] }
export interface RunReview { label: string; pin: ReviewPin; title: string }
export interface PrivateRunOutput { name: string; bytes: number; sha256: string; members: number; receiptKey: string }
export type RunBridge = typeof bridgeRequest;
export const maxArchiveBytes = 8 * 1024 * 1024;

export function parseObservabilityPointer(text: string, path: string) {
  const p = observabilityPointerSchema.parse(JSON.parse(text));
  const expected = `workflow-runs/github-${p.github_run_id}/observability/attempts/${p.github_run_attempt}/${p.github_job_instance}.json`;
  if (path !== expected || p.payload_key !== `observability/github/${p.repository}/${p.github_run_id}-${p.github_run_attempt}/${p.github_job_instance}/payload.tgz`) throw Error('Workspace observability pointer identity mismatch.');
  s3Key(p.prefix); s3Key(p.payload_key);
  return p;
}
export function runIdentity(p: Pick<ObservabilityPointer, 'repository' | 'github_run_id' | 'github_run_attempt'>) { return `${p.repository.toLowerCase()}/${p.github_run_id}/${p.github_run_attempt}`; }
export function sortWorkspaceRuns(runs: WorkspaceRun[]) {
  return [...runs].sort((a, b) => (b.metadata?.created_at ?? '').localeCompare(a.metadata?.created_at ?? '') || b.run - a.run || b.attempt - a.attempt || a.key.localeCompare(b.key));
}
async function mapBounded<T, R>(items: T[], work: (item: T) => Promise<R>, concurrency = 3) {
  const results: R[] = new Array(items.length); let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => { while (index < items.length) { const current = index++; results[current] = await work(items[current]); } }));
  return results;
}

/** Read-only compatibility adapter. New runtime writes do not belong in Documents.
 * Membership is resolved from this workspace snapshot BEFORE reading any Actions metadata.
 */
export class WorkspaceRuns {
  constructor(private send: RunBridge = bridgeRequest) {}
  async list(scope: WorkspaceScope, actionsConnection = { id: scope.connectionId, installationId: scope.installationId }): Promise<RunInventory> {
    const reader = new WorkspaceReader(this.send, scope.connectionId, scope.repository, scope.installationId, scope.workspace);
    const workspace = (await reader.discover()).find(item => item.name === scope.workspace);
    if (!workspace) throw Error('Selected workspace is unavailable.');
    const { snapshot } = await reader.open(workspace);
    const entries = documents(snapshot).filter(item => /^documents\/workflow-runs\/github-\d+\/observability\/attempts\/\d+\/[\w-]+\.json$/.test(item.path));
    if (entries.length > 200) throw Error('This legacy workspace has more than 200 observability pointers. A paginated typed workflow index is required; history was not silently truncated.');
    const groups = new Map<string, RunAssociation>(), notices: string[] = [];
    let workspaceRef: string | undefined;
    const pointers = await mapBounded(entries, async entry => {
      if ((entry.size ?? Infinity) > 32 * 1024) throw Error('Observability pointer exceeds 32 KiB.');
      const text = documentText(await reader.blob(entry));
      const value = JSON.parse(text);
      if (typeof value.repository === 'string' && !/^[\w.-]+\/gh-agentic-workflows$/i.test(value.repository)) return undefined;
      return { entry, pointer: parseObservabilityPointer(text, entry.path.slice(10)) };
    });
    for (const found of pointers) {
      if (!found) continue;
      const { entry, pointer: p } = found;
      if (workspaceRef && workspaceRef !== p.workspace_ref) throw Error('Workspace pointers disagree about the stable workspace identity.');
      workspaceRef = p.workspace_ref;
      const key = runIdentity(p), run = groups.get(key) ?? { key, repository: p.repository, run: Number(p.github_run_id), attempt: Number(p.github_run_attempt), pointers: [], sources: [] };
      run.pointers.push(p); run.sources.push({ resource: entry.path.slice(10), version_kind: 'git-blob', version: entry.sha, snapshot: snapshot.commit }); groups.set(key, run);
    }
    const runs = await mapBounded([...groups.values()], async run => {
      const manifest = documents(snapshot).find(item => item.path === `documents/workflow-runs/github-${run.run}/run.json`);
      if (manifest && (manifest.size ?? Infinity) <= 32 * 1024) {
        const value = JSON.parse(documentText(await reader.blob(manifest)));
        if (value.id === `github-${run.run}` && typeof value.task === 'string') run.task = value.task;
      }
      try { return { ...run, metadata: await this.send<ActionRun>({ operation: 'actionsRead', ...actionsConnection, repository: run.repository, run: run.run, attempt: run.attempt, kind: 'run', page: 1 }) }; }
      catch (cause) { return { ...run, error: cause instanceof Error ? cause.message : String(cause) }; }
    });
    notices.push('Legacy workspace associations: only published post-job observability links are discoverable. Queued, unassociated and newer typed-only executions are not inferred. Refresh pins a new workspace snapshot.');
    return { snapshot: snapshot.commit, workspaceRef, runs: sortWorkspaceRuns(runs), notices };
  }
  async detail(scope: WorkspaceScope, run: WorkspaceRun, connection = { id: scope.connectionId, installationId: scope.installationId }) {
    const base = { operation: 'actionsRead' as const, ...connection, repository: run.repository, run: run.run, attempt: run.attempt };
    async function pages<T>(kind: 'jobs' | 'artifacts', send: RunBridge): Promise<T[]> {
      const all: T[] = [];
      for (let page = 1; page <= 10; page++) {
        const result = await send<{ total_count: number; jobs?: T[]; artifacts?: T[] }>({ ...base, kind, page });
        const items = result[kind] ?? []; all.push(...items);
        if (all.length >= result.total_count) return all;
        if (!items.length) throw Error(`Incomplete ${kind} pagination.`);
      }
      throw Error(`${kind} exceeds the 1,000-item detail limit; totals are unavailable.`);
    }
    const [jobs, artifacts] = await Promise.allSettled([pages<ActionJob>('jobs', this.send), pages<ActionArtifact>('artifacts', this.send)]);
    return { jobs: jobs.status === 'fulfilled' ? jobs.value : undefined, artifacts: artifacts.status === 'fulfilled' ? artifacts.value : undefined,
      errors: [jobs, artifacts].filter(item => item.status === 'rejected').map(item => String((item as PromiseRejectedResult).reason)) };
  }
  async reviews(scope: WorkspaceScope, run: WorkspaceRun): Promise<RunReview[]> {
    const reader = new ReviewReader(new WorkspaceReader(this.send, scope.connectionId, scope.repository, scope.installationId, scope.workspace), scope.workspace);
    const refs = run.pointers.flatMap(p => p.related_reviews ?? []);
    const result: RunReview[] = [];
    for (const ref of refs) {
      const review = await reader.open(ref.request);
      result.push({ label: ref.relation, pin: review.pin, title: review.request.title });
    }
    // Same-task links are explicit contextual relationships, never claimed outputs.
    if (run.task) {
      const snapshot = await reader.reader.snapshot(run.sources[0].snapshot);
      const requests = await reader.list(snapshot);
      for (const review of requests.filter(item => item.request.bead_id === run.task)) {
        if (!result.some(item => item.pin.version === review.pin.version)) result.push({ label: 'Same task — not proven run output', pin: review.pin, title: review.request.title });
      }
    }
    return result;
  }
  connections() { return this.send<PublicS3Connection[]>({ operation: 's3Connections' }); }
  async outputs(pointer: ObservabilityPointer, connection: PublicS3Connection): Promise<PrivateRunOutput[]> {
    if (!connection.allowRead || pointer.bucket !== connection.bucket) throw Error('Select a read-enabled S3 connection for the publisher bucket.');
    const prefix = [pointer.prefix.replace(/^\/+|\/+$/g, ''), `workflow-files/github/${pointer.repository}/${pointer.github_run_id}-${pointer.github_run_attempt}/`].filter(Boolean).join('/');
    if (!prefix.startsWith(connection.prefix)) throw Error('Private output prefix is outside this connection grant.');
    const receipts: string[] = []; let continuationToken: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result: S3Listing = await this.send({ operation: 's3List', id: connection.id, revision: connection.revision, prefix, continuationToken });
      for (const object of result.objects) {
        if (!object.key.startsWith(prefix)) throw Error('Private output listing escaped the selected attempt.');
        if (/^[a-zA-Z0-9][\w.-]*\/receipt\.json$/.test(object.key.slice(prefix.length))) { if (object.size > 65536) throw Error('Private output receipt exceeds 64 KiB.'); receipts.push(object.key); }
      }
      continuationToken = result.continuationToken;
      if (!continuationToken) break;
    }
    if (continuationToken || receipts.length > 100) throw Error('Private outputs exceed this view’s bounded inventory limit.');
    return mapBounded(receipts, async receiptKey => {
      const object = await this.send<S3Object>({ operation: 's3Read', id: connection.id, revision: connection.revision, key: receiptKey });
      if (object.size > 65536) throw Error('Private output receipt exceeds 64 KiB.');
      const value = z.object({ schema_version: z.literal(1), repository: z.literal(pointer.repository), github_run_id: z.literal(pointer.github_run_id), github_run_attempt: z.literal(pointer.github_run_attempt), name: z.string().regex(/^[\w-]+$/), payload_key: z.string(), bytes: z.number().int().nonnegative(), sha256: digest, members: z.array(z.unknown()).max(10000) }).parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeObject(object, receiptKey))));
      if (!receiptKey.endsWith(`/${value.name}/receipt.json`) || value.payload_key !== `workflow-files/github/${pointer.repository}/${pointer.github_run_id}-${pointer.github_run_attempt}/${value.name}/payload.tgz`) throw Error('Private output receipt locator mismatch.');
      return { name: value.name, bytes: value.bytes, sha256: value.sha256, members: value.members.length, receiptKey };
    });
  }
  async readArchive(pointer: ObservabilityPointer, connection: PublicS3Connection) {
    if (!connection.allowRead || connection.bucket !== pointer.bucket) throw Error('Choose a read-enabled S3 connection for the receipt bucket.');
    const key = [pointer.prefix.replace(/^\/+|\/+$/g, ''), pointer.payload_key].filter(Boolean).join('/');
    if (!key.startsWith(connection.prefix) || pointer.bytes > maxArchiveBytes) throw Error('Archive is outside the allowed prefix or exceeds the 8 MiB limit. Select another job or use a bounded derived export.');
    const receiptKey = key.replace(/payload\.tgz$/, 'receipt.json');
    const receiptObject = await this.send<S3Object>({ operation: 's3Read', id: connection.id, revision: connection.revision, key: receiptKey });
    const receipt = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeObject(receiptObject, receiptKey)));
    for (const field of ['repository', 'github_run_id', 'github_run_attempt', 'github_job_instance', 'payload_key', 'sha256', 'bytes'] as const) if (receipt[field] !== pointer[field]) throw Error(`S3 receipt disagrees with workspace pointer: ${field}.`);
    const object = await this.send<S3Object>({ operation: 's3Read', id: connection.id, revision: connection.revision, key });
    const bytes = decodeObject(object, key);
    if (bytes.length !== pointer.bytes || await sha256(bytes) !== pointer.sha256) throw Error('Telemetry archive digest mismatch.');
    const members = z.array(z.object({ name: z.string(), bytes: z.number().int().nonnegative(), sha256: digest })).max(2048).parse(receipt.members);
    return { bytes, members };
  }
}
function decodeObject(object: S3Object, key: string) {
  if (object.key !== key || object.size > maxArchiveBytes || object.base64.length > Math.ceil(maxArchiveBytes / 3) * 4) throw Error('Unexpected or oversized S3 object.');
  const bytes = Uint8Array.from(atob(object.base64), char => char.charCodeAt(0));
  if (bytes.length !== object.size) throw Error('S3 object size mismatch.');
  return bytes;
}
export async function sha256(bytes: Uint8Array<ArrayBuffer>) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
