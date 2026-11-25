import { z } from 'zod';
import { hostedRequestSchema, trustedOrigin, type HostedConnection } from './hosted-protocol';
import { boundedJSON, gitReadSchema, maxMetadataBytes, readGit, verifiedGitBlobBytes, type GitBlob, type GitRead } from './git-reads';
import { agentSnapshot, agentTree } from './agent-snapshot';
import { readOnlyGraphql } from './agent-graphql';
import { ApiReadCache, responseCooldown, type ApiCooldown } from './github-rate-limit';
import { hostedGrants, loadedDocument, matchesGrant, trustedSubpath, type HostedGrant } from './hosted-access';
import type { WorkspaceNavigation } from './workspace-navigation';
import { writeReview } from './review-writes';
import { pilotReviewDispatch, type ReviewDispatchHost } from './review-dispatch';
import type { ReviewReceipt } from './review-protocol';
import type { ReviewDeliveryRoute } from './review-io';
import { responseRun, type ReviewWorkflowProgress } from './review-progress';
import { cacheSettingsSchema } from './cache-settings';
import type { CacheScope, WorkspaceCache } from './workspace-cache';
import { copyCacheValue } from './workspace-cache';
import { BoundedReads } from './bounded-reads';
import { nativeReadConcurrency, nativeReadResponseBytes } from './git-read-limits';
import { documentCache, reviewCachePinsKey } from './document-cache';
import type { VdConnections } from './vd-connections';
import { actionPath, actionResult } from './actions-protocol';
import { developmentHost, workflowRunName, type WorkflowDelivery } from './workflow-interface';
import { readWorkflowProgress } from './workflow-progress';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const requestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('cacheSettings') }).strict(),
  z.object({ operation: z.literal('saveCacheSettings'), settings: cacheSettingsSchema }).strict(),
  z.object({ operation: z.literal('list') }).strict(),
  z.object({ operation: z.literal('add'), name: z.string().trim().min(1).max(80), appId: z.number().int().positive(), clientId: identifier }).strict(),
  ...(['start', 'poll', 'refresh', 'installations', 'repositories', 'disconnect', 'remove'] as const).map(operation => z.object({ operation: z.literal(operation), id: z.string().uuid() }).strict()),
  z.object({ operation: z.literal('selectInstallation'), id: z.string().uuid(), installationId: z.number().int().positive() }).strict(),
  z.object({ operation: z.literal('probe'), id: z.string().uuid(), repository: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/).max(220) }).strict(),
  z.object({ operation: z.enum(['grantOrigin', 'revokeOrigin']), id: z.string().uuid(), origin: z.string().max(300), subpath: z.string().max(1000).default('/'), replace: z.object({ origin: z.string().max(300), subpath: z.string().max(1000) }).strict().optional() }).strict(),
]);
export type ConnectionRequest = z.infer<typeof requestSchema>;
type Identity = { login: string; id: number };
type Tokens = { accessToken: string; refreshToken?: string; expiresAt: number; refreshExpiresAt?: number };
type Pending = { deviceCode: string; userCode: string; expiresAt: number; interval: number; nextPollAt: number };
export type ConnectionRecord = {
  id: string; name: string; appId: number; clientId: string; user?: Identity;
  installation?: { id: number; account: string }; tokens?: Tokens; pending?: Pending;
  origins?: string[];
  hostedGrants?: HostedGrant[];
  recentNavigation?: { source: string; updatedAt: number; navigation: WorkspaceNavigation }[];
  reviewDeliveries?: Record<string, ReviewReceipt>;
  workflowDeliveries?: Record<string, WorkflowDelivery>;
  apiCooldown?: ApiCooldown;
  cacheGeneration?: number;
};
export interface ConnectionStore {
  all(): Promise<ConnectionRecord[]>;
  get(id: string): Promise<ConnectionRecord | undefined>;
  put(record: ConnectionRecord): Promise<void>;
  remove(id: string): Promise<void>;
}
const tokenSchema = z.object({
  access_token: z.string().min(1), token_type: z.literal('bearer'), expires_in: z.number().positive(),
  refresh_token: z.string().min(1), refresh_token_expires_in: z.number().positive(),
});
const installationSchema = z.object({
  id: z.number().int().positive(), app_id: z.number().int(), account: z.object({ login: z.string() }),
  permissions: z.record(z.string(), z.string()),
});
const repoSchema = z.object({ full_name: z.string(), private: z.boolean(), default_branch: z.string() });
export type Installation = z.infer<typeof installationSchema>;
export type Repository = z.infer<typeof repoSchema>;
export class ConnectionError extends Error { override name = 'ConnectionError'; }
class ConnectionTransportError extends ConnectionError {}

function publicConnection(record: ConnectionRecord) {
  const { id, name, appId, clientId, user, installation, tokens, pending } = record;
  return {
    id, name, appId, clientId, user, installation, connected: Boolean(tokens), expiresAt: tokens?.expiresAt,
    refreshExpiresAt: tokens?.refreshExpiresAt,
    hostedGrants: hostedGrants(record),
    recentNavigation: (record.recentNavigation ?? []).map(({ source, navigation }) => ({ source, navigation })),
    pending: pending && { userCode: pending.userCode, expiresAt: pending.expiresAt, nextPollAt: pending.nextPollAt },
  };
}
export type PublicConnection = ReturnType<typeof publicConnection>;

// This module runs only in the privileged broker. No token-bearing record is a
// message response, and callers cannot choose an endpoint, method or headers.
export class Connections {
  private tail: Promise<unknown> = Promise.resolve();
  private apiCache = new ApiReadCache(96 * 1024 * 1024);
  private nativeReads = new BoundedReads(nativeReadConcurrency, nativeReadResponseBytes);
  private epoch = 0;
  constructor(private store: ConnectionStore, private fetcher: typeof fetch = (...args) => fetch(...args), private now = () => Date.now(), private newId = () => crypto.randomUUID() as string, private timeout = (ms: number) => AbortSignal.timeout(ms), private persistentCache?: WorkspaceCache, private reviewDispatch: ReviewDispatchHost = pilotReviewDispatch, private vd?: VdConnections) {}

  handle(input: unknown): Promise<unknown> {
    const request = requestSchema.parse(input);
    if (['disconnect', 'remove', 'revokeOrigin', 'selectInstallation'].includes(request.operation)) this.epoch++;
    // Serialize refresh rotation, disconnect and polling, including concurrent
    // requests from multiple settings tabs. Persist each transition before reply.
    const result = this.tail.catch(() => {}).then(() => this.execute(request));
    this.tail = result;
    return result;
  }

  handleHosted(documentURL: string, input: unknown, isCurrent: () => boolean = () => true): Promise<unknown> {
    const epoch = this.epoch, callerCurrent = isCurrent;
    isCurrent = () => callerCurrent() && epoch === this.epoch;
    const source = loadedDocument(documentURL);
    const request = hostedRequestSchema.parse(input);
    if ((request.operation === 'gitBlob' || request.operation === 'gitBlobPart') && request.namespace === 'dolt' && !request.cacheOnly) {
      return this.nativeReads.run((request.operation === 'gitBlobPart' ? 96 : 24) * 1024 * 1024, () => this.readNativeBlob(source, request, isCurrent)).then(value => {
        if (!isCurrent()) throw new ConnectionError('Document or connection access changed. Reconnect explicitly.');
        return value;
      });
    }
    const result = this.tail.catch(() => {}).then(async () => {
      if (!isCurrent()) throw new ConnectionError('Document or connection access changed. Reconnect explicitly.');
      const records = await this.store.all();
      if (!isCurrent()) throw new ConnectionError('Document or connection access changed. Reconnect explicitly.');
      const approved = records.filter(record => hostedGrants(record).some(grant => matchesGrant(grant, source)));
      if (!approved.length) throw new ConnectionError('This document has no approved connections. Grant its origin and subpath access in connection settings and reload the page.');
      if (request.operation === 'discover') return { protocolVersion: 1, capabilities: ['connections', 'repositories', 'probe', 'gitRefs', 'gitCommit', 'gitTree', 'gitBlob', 'gitBlobPart', 'agentGraphql', 'agentSnapshot', 'agentTree', 'agentBlob', 's3Checkpoint', 's3Versions', 's3AllowMissing', 'beadsServingPacks', 'implicitWorkspaces', 'rememberNavigation', 'reviewWrite', 'reviewQueue', 'qrspiProcessReview', 'qrspiWorkflowProgress', 'actionsRead', ...(this.persistentCache ? ['persistedWorkspaceCache', 'documentSnapshots'] : [])] };
      if (request.operation === 'connections') return approved.filter(record => record.tokens && record.installation).map(({ id, name, appId, user, installation }): HostedConnection => ({ id, name, appId, user, installation }));
      if (request.operation === 'workflowCatalog') return { interfaceVersion: 1, workflows: [{ id: 'development', ...developmentHost, requestVersion: 2, method: 'implement-review-test', maxCycles: 4 }], connections: approved.filter(record => record.tokens && record.installation && record.user).map(({ id, name, user, installation, workflowDeliveries }) => ({ id, name, userId: user!.id, installationId: installation!.id, executions: Object.values(workflowDeliveries ?? {}).filter(value => value.workspace === request.workspace && value.userId === user!.id && value.installationId === installation!.id) })) };
      if (request.operation === 'vdConnections') return this.vd?.publicConnections(documentURL) ?? [];
      const navigationSource = source.origin + source.pathname;
      if (request.operation === 'forgetNavigation') {
        for (const record of records) {
          if (!record.recentNavigation?.some(item => item.source === navigationSource)) continue;
          record.recentNavigation = record.recentNavigation.filter(item => item.source !== navigationSource);
          await this.store.put(record);
        }
        return null;
      }
      if (request.operation === 'loadNavigation') {
        const recent = records.flatMap(record => record.recentNavigation ?? []).filter(item => item.source === navigationSource).sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (!recent) return null;
        const record = approved.find(record => record.id === recent.navigation.connectionId);
        if (!record?.tokens || record.installation?.id !== recent.navigation.installationId) throw new ConnectionError('The saved connection or installation is unavailable. Choose a connection; no fallback was used.');
        return recent.navigation;
      }
      if (request.operation === 'saveNavigation') {
        const record = approved.find(record => record.id === request.navigation.connectionId);
        if (!record?.tokens || record.installation?.id !== request.navigation.installationId) throw new ConnectionError('The selected installation changed. No navigation preference was saved.');
        const updatedAt = Math.max(this.now(), ...records.flatMap(item => (item.recentNavigation ?? []).map(recent => recent.updatedAt + 1)));
        record.recentNavigation = [...(record.recentNavigation ?? []).filter(item => item.source !== navigationSource), { source: navigationSource, updatedAt, navigation: request.navigation }].slice(-20);
        await this.store.put(record);
        return null;
      }
      if (!('id' in request)) throw new ConnectionError('Unsupported hosted operation.');
      const record = approved.find(record => record.id === request.id);
      if (!record) throw new ConnectionError('This connection is not approved for the original document path.');
      if (request.operation === 'workflowStart' || request.operation === 'workflowStatus') {
        if (!record.tokens || record.user?.id !== request.userId || record.installation?.id !== request.installationId) throw new ConnectionError('The workflow GitHub user or installation changed.');
        const installation = (await this.installations(record)).find(item => item.id === request.installationId);
        const repo = (await this.repositories(record)).find(item => item.full_name.toLowerCase() === developmentHost.repository.toLowerCase());
        if (!repo || !installation || !['read', 'write'].includes(installation.permissions.actions ?? '')) throw new ConnectionError('Actions access to the configured workflow repository is required.');
        const deliveries = record.workflowDeliveries ?? {};
        if (request.operation === 'workflowStart') {
          if (installation.permissions.actions !== 'write') throw new ConnectionError('Starting a workflow requires Actions write permission.');
          const identity = JSON.stringify([request.userId, request.installationId, request.workspace, request.request.thread, request.request.process]);
          const digest = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([request.workspace, request.request, request.allowSourceEffects]))));
          const previous = deliveries[identity];
          if (previous) {
            if (previous.digest !== digest) throw new ConnectionError('Workflow identity already has different inputs. Inspect its existing execution.');
            return previous;
          }
          if (Object.keys(deliveries).length >= 200) throw new ConnectionError('Workflow receipt capacity reached. Existing uncertain receipts must be retained.');
          const head = z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) }).parse(await this.api(record, `/repos/${repo.full_name}/commits/${encodeURIComponent(developmentHost.ref)}`, maxMetadataBytes, 'none'));
          const delivery: WorkflowDelivery = { executionReference: this.newId(), digest, workspace: request.workspace, thread: request.request.thread, process: request.request.process, engineCommit: head.sha, userId: request.userId, installationId: request.installationId, attemptedAt: new Date(this.now()).toISOString(), state: 'dispatch-unknown' };
          if (!isCurrent()) throw new ConnectionError('Connection access changed before dispatch.');
          record.workflowDeliveries = { ...deliveries, [identity]: delivery };
          await this.store.put(record); // Durable intent BEFORE POST; restart never retries it.
          try {
            await this.api(record, `/repos/${repo.full_name}/actions/workflows/${developmentHost.workflow}/dispatches`, maxMetadataBytes, 'none', { method: 'POST', body: { ref: developmentHost.ref, inputs: { workspace: request.workspace, request: JSON.stringify(request.request), 'allow-source-effects': 'true', 'engine-commit': head.sha, operation: 'run' } }, isCurrent });
            record.workflowDeliveries[identity] = { ...delivery, state: 'dispatched' };
            await this.store.put(record);
            return record.workflowDeliveries[identity];
          } catch { return delivery; } // The POST or receipt write may have succeeded. Never replay.
        }
        // A shared checkpoint may supply an original receipt on another device.
        // It grants read-only reconciliation, never launch/deduplication authority.
        const recovered = request.recoveryReceipt;
        const owned = Object.entries(deliveries).find(([, value]) => value.executionReference === request.executionReference);
        const entry = owned
          ?? (recovered?.executionReference === request.executionReference ? [JSON.stringify([recovered.userId, recovered.installationId, recovered.workspace, recovered.thread, recovered.process]), recovered] as const : undefined);
        if (!entry || entry[1].userId !== request.userId || entry[1].installationId !== request.installationId) throw new ConnectionError('No execution receipt in this authenticated connection. Recover the original shared receipt; do not start replacement work.');
        const [key, delivery] = entry;
        const runs: any[] = [];
        if (delivery.runId) runs.push(await this.api(record, `/repos/${repo.full_name}/actions/runs/${delivery.runId}`, maxMetadataBytes, 'none'));
        else for (let page = 1; page <= 5; page++) {
          const listing = z.object({ workflow_runs: z.array(z.unknown()).max(100) }).parse(await this.api(record, `/repos/${repo.full_name}/actions/workflows/${developmentHost.workflow}/runs?branch=${encodeURIComponent(developmentHost.ref)}&event=workflow_dispatch&per_page=100&page=${page}`, maxMetadataBytes, 'none'));
          runs.push(...listing.workflow_runs);
          if (listing.workflow_runs.length < 100) break;
        }
        const matches = runs.filter(run => run.display_title === workflowRunName(delivery) && run.event === 'workflow_dispatch' && run.head_branch === developmentHost.ref && run.actor?.id === delivery.userId && run.head_sha === delivery.engineCommit && Date.parse(run.created_at) >= Date.parse(delivery.attemptedAt) - 60000);
        if (matches.length !== 1) return { ...delivery, executionState: matches.length ? 'ambiguous' : 'unconfirmed', message: 'No unique exact run association. Inspect; do not redispatch or allocate a replacement process.' };
        const run = z.object({ id: z.number().int().positive(), run_attempt: z.number().int().positive(), status: z.string().max(100), conclusion: z.string().max(100).nullable() }).parse(matches[0]);
        const associated = { ...delivery, runId: run.id };
        // Only update a host-owned launch record. Caller-supplied observations
        // must not poison the host's effect/idempotency ledger.
        if (owned) { record.workflowDeliveries = { ...deliveries, [key]: associated }; await this.store.put(record); }
        const observed = await readWorkflowProgress(delivery, run, path => this.api(record, `/repos/${repo.full_name}${path}`, maxMetadataBytes, 'none'));
        const timestamps = z.object({ created_at: z.string().datetime().optional(), run_started_at: z.string().datetime().nullable().optional() }).parse(matches[0]);
        return { ...associated, ...observed, createdAt: timestamps.created_at, startedAt: timestamps.run_started_at, executionState: run.status, conclusion: run.conclusion, attempt: run.run_attempt, runUrl: `https://github.com/${repo.full_name}/actions/runs/${run.id}`, reportName: `threads/${delivery.thread}/development/${delivery.process}.md`, candidateAcceptance: 'unknown-until-bound-report' };
      }
      if (request.operation === 'agentGraphql') {
        if (!record.tokens || record.user?.id !== request.userId || record.installation?.id !== request.installationId) throw new ConnectionError('The agent GitHub user or installation changed.');
        let body: ReturnType<typeof readOnlyGraphql>;
        try { body = readOnlyGraphql(request.query, request.variables); }
        catch (error) { throw new ConnectionError(error instanceof Error ? error.message : 'Invalid GraphQL query.'); }
        return this.api(record, '/graphql', maxMetadataBytes, 'none', { method: 'POST', body, isCurrent });
      }
      if (request.operation === 'agentSnapshot' || request.operation === 'agentTree' || request.operation === 'agentBlob') {
        if (!record.tokens || record.user?.id !== request.userId || record.installation?.id !== request.installationId) throw new ConnectionError('The agent GitHub user or installation changed.');
        const repo = (await this.repositories(record)).find(item => item.full_name.toLowerCase() === request.repository.toLowerCase());
        if (!repo) throw new ConnectionError('Repository is not available through this installation and user.');
        const api = (path: string, limit?: number) => { if (!isCurrent()) throw new ConnectionError('GitHub access changed.'); return this.api(record, path, limit, 'immutable'); };
        const graphql = async (query: string, variables: Record<string, unknown>) => {
          const value = await this.api(record, '/graphql', maxMetadataBytes, 'none', { method: 'POST', body: readOnlyGraphql(query, variables), isCurrent });
          return value;
        };
        try {
          if (request.operation === 'agentTree') return await agentTree(request.repository, request.oid, graphql);
          if (request.operation === 'agentBlob') {
            const value = await api(`/repos/${repo.full_name}/git/blobs/${request.oid}`, 192 * 1024);
            const blob = z.object({ sha: z.literal(request.oid), size: z.number().int().min(0).max(128 * 1024), encoding: z.literal('base64'), content: z.string().max(192 * 1024) }).parse(value);
            verifiedGitBlobBytes(blob); return blob;
          }
          return await agentSnapshot(request, api, graphql);
        } catch (error) { throw new ConnectionError(error instanceof Error ? error.message : 'Workspace read failed.'); }
      }
      if (request.operation === 'agentRepositories' || request.operation === 'agentProbe') {
        if (!record.tokens || record.user?.id !== request.userId || record.installation?.id !== request.installationId) throw new ConnectionError('The agent GitHub user or installation changed. Reconnect explicitly.');
        return request.operation === 'agentRepositories' ? this.repositories(record) : this.execute({ operation: 'probe', id: record.id, repository: request.repository });
      }
      if (request.operation === 'documentCache') {
        if (!this.persistentCache) throw new ConnectionError('Persistent workspace cache is unavailable.');
        if (!record.tokens || !record.user || record.installation?.id !== request.installationId) throw new ConnectionError('Sign in and select the original installation before caching documents.');
        const scope: CacheScope = { connection: record.id, account: record.user.id, installation: record.installation.id, generation: record.cacheGeneration, repository: request.repository, workspace: request.workspace, namespace: 'documents' };
        if (request.action === 'fill') {
          const repo = (await this.repositories(record)).find(repo => repo.full_name.toLowerCase() === request.repository.toLowerCase());
          if (!repo) { await this.retireCache(record); throw new ConnectionError('Access denied: repository is not available through the selected installation and user.'); }
        }
        return documentCache(this.persistentCache, scope, request, <T>(input: GitRead) => readGit(input, request.repository, (path, limit) => this.api(record, path, limit, input.operation === 'gitRefs' ? 'conditional' : 'immutable')) as Promise<T>, isCurrent);
      }
      if (request.operation === 'actionsRead') {
        if (!record.user || !record.tokens || record.installation?.id !== request.installationId) throw new ConnectionError('Reconnect the selected Actions connection and installation.');
        const installation = (await this.installations(record)).find(item => item.id === request.installationId);
        const repo = (await this.repositories(record)).find(item => item.full_name.toLowerCase() === request.repository.toLowerCase());
        if (!repo || !installation || !['read', 'write'].includes(installation.permissions.actions ?? '')) throw new ConnectionError('Actions read access is required on this repository.');
        return actionResult(request, await this.api(record, actionPath(request), maxMetadataBytes, 'conditional'));
      }
      if (request.operation === 'reviewProgress') {
        if (!record.user || !record.tokens || record.installation?.id !== request.installationId) throw new ConnectionError('Reconnect the original authenticated reviewer and installation to read workflow progress.');
        const repo = (await this.repositories(record)).find(repo => repo.full_name.toLowerCase() === request.repository.toLowerCase());
        if (!repo) throw new ConnectionError('Storage repository access is unavailable.');
        const key = JSON.stringify([repo.full_name.toLowerCase(), request.workspace, request.resource, request.version, `github:${record.user.id}`]);
        const receipt = record.reviewDeliveries?.[key];
        const checked_at = new Date(this.now()).toISOString();
        if (!receipt) return {state:'unknown', checked_at, message:'No retained delivery receipt is available in this broker. The saved response is not evidence of workflow failure.'} satisfies ReviewWorkflowProgress;
        const host = this.reviewDispatch;
        const source = host.sourceConnectionId ? approved.find(item => item.id === host.sourceConnectionId) : record;
        if (!source?.tokens || !source.user || source.user.id !== record.user.id || !source.installation) throw new ConnectionError('The same-reviewer source connection is required to read Actions progress.');
        const installation = (await this.installations(source)).find(item => item.id === source.installation!.id);
        const sourceRepo = (await this.repositories(source)).find(item => item.full_name.toLowerCase() === host.repository.toLowerCase());
        if (!installation || !['read','write'].includes(installation.permissions.actions ?? '') || !sourceRepo) throw new ConnectionError('Actions read access is required on the trusted source repository.');
        const runs: any[] = [];
        for (let page = 1; page <= 5; page++) {
          const listing = z.object({workflow_runs:z.array(z.unknown()).max(100)}).parse(await this.api(source, `/repos/${host.repository}/actions/workflows/${encodeURIComponent(host.workflow)}/runs?branch=${encodeURIComponent(host.ref)}&event=workflow_dispatch&per_page=100&page=${page}`, maxMetadataBytes, 'none'));
          runs.push(...listing.workflow_runs);
          if (listing.workflow_runs.length < 100) break;
        }
        return {...responseRun(runs, receipt.version, host.repository, host.ref, record.user.id), checked_at, dispatch:receipt.dispatch} satisfies ReviewWorkflowProgress;
      }
      if (request.operation === 'reviewWrite') {
        if (!record.user || !record.tokens || record.installation?.id !== request.installationId) throw new ConnectionError('The authenticated reviewer or installation changed. Reconnect before saving.');
        const installation = (await this.installations(record)).find(item => item.id === request.installationId);
        if (installation?.permissions.contents !== 'write') throw new ConnectionError('Saving review drafts and responses requires Contents: read and write on this GitHub App installation. Approve the updated permissions and select the installation again.');
        const repo = (await this.repositories(record)).find(repo => repo.full_name.toLowerCase() === request.repository.toLowerCase());
        if (!repo) throw new ConnectionError('Repository is not available through the selected installation and user.');
        const requireCurrent = () => { if (!isCurrent()) throw new ConnectionError('Document or connection access changed. Reconnect explicitly.'); };
        try {
          return await writeReview({ ...request, repository: repo.full_name }, `github:${record.user.id}`,
            <T>(input: import('./git-reads').GitRead) => { requireCurrent(); return readGit(input, repo.full_name, (path, limit) => { requireCurrent(); return this.api(record, path, limit, input.operation === 'gitRefs' ? 'none' : 'immutable'); }) as Promise<T>; },
            (path, method, body) => { requireCurrent(); return this.api(record, path, maxMetadataBytes, 'none', { method, body, isCurrent }); },
            (receipt, review) => review.process ? this.dispatchReview(record, approved, repo.full_name, receipt, review, isCurrent)
              : this.vd ? this.vd.deliver(documentURL, repo.full_name, receipt, review, isCurrent)
                : Promise.resolve({ ...receipt, dispatch: { kind: 'vk' as const, state: 'pending' as const, message: 'Response saved. Update the extension/native host and configure a VD connection to notify VK.' } }));
        } catch (error) { throw new ConnectionError(error instanceof Error ? error.message : 'Review save failed. Retry after reconnecting.'); }
      }
      if (gitReadSchema.safeParse(request).success) {
        const gitRequest = gitReadSchema.parse(request);
        if (!record.tokens || !record.user) throw new ConnectionError('Sign in before reading workspace data.');
        if (record.installation?.id !== gitRequest.installationId) throw new ConnectionError('The selected installation changed. Reconnect and rediscover workspaces; no fallback is allowed.');
        if (gitRequest.operation === 'gitBlobPart') {
          if (gitRequest.cacheOnly) throw new ConnectionError('Large Dolt blob parts require an online authorized read.');
          const repo = (await this.repositories(record)).find(repo => repo.full_name.toLowerCase() === gitRequest.repository.toLowerCase());
          if (!repo) { await this.retireCache(record); throw new ConnectionError('Access denied: repository is not available through the selected installation and user.'); }
          // Only the small part crosses the bridge. The bounded full upstream
          // object is cached transiently under the connection/installation key.
          const result = await readGit(gitRequest, repo.full_name, (path, limit) => this.api(record, path, limit, 'immutable'));
          if (!isCurrent()) throw new ConnectionError('Document or connection access changed.');
          return result;
        }
        const scope: CacheScope = { connection: record.id, account: record.user.id, installation: record.installation.id, generation: record.cacheGeneration,
          repository: gitRequest.repository, workspace: 'workspace' in gitRequest ? gitRequest.workspace : '',
          namespace: gitRequest.operation === 'gitRefs' ? 'metadata' : gitRequest.namespace ?? 'documents' };
        const resource = gitRequest.operation === 'gitRefs' ? gitRequest.prefix : `${gitRequest.operation}:${gitRequest.oid}`;
        if (gitRequest.cacheRetain && gitRequest.operation !== 'gitRefs' && scope.namespace === 'documents' && this.persistentCache) {
          const pins = z.array(z.string()).max(10000).parse(await this.persistentCache.get(scope, reviewCachePinsKey) ?? []);
          if (!pins.includes(resource) && !pins.includes('*')) {
            // Conservatively disable per-object collection at the bounded pin-index
            // limit. Whole-workspace LRU eviction still enforces count/byte limits.
            const retained = pins.length >= 9999 ? [...pins, '*'] : [...pins, resource];
            if (!await this.persistentCache.put(scope, reviewCachePinsKey, retained)) throw new ConnectionError('Unable to retain the review revision in the workspace cache. Check cache capacity and retry.');
          }
        }
        let cached = await this.persistentCache?.get(scope, resource, gitRequest.cacheOnly || gitRequest.cacheVisit);
        if (cached !== undefined) {
          try { cached = await readGit(gitRequest, gitRequest.repository, async () => cached); if (gitRequest.operation === 'gitBlob') verifiedGitBlobBytes(cached as GitBlob); }
          catch { await this.persistentCache?.remove(scope, resource).catch(() => {}); cached = undefined; }
        }
        if (gitRequest.cacheOnly) {
          if (cached === undefined) throw new ConnectionError('No persisted workspace read is available.');
          // The same response validators apply to disk and HTTP data. Blob bytes
          // are additionally hashed by WorkspaceReader before being displayed.
          return readGit(gitRequest, gitRequest.repository, async () => cached);
        }
        const repo = (await this.repositories(record)).find(repo => repo.full_name.toLowerCase() === gitRequest.repository.toLowerCase());
        if (!repo) { await this.retireCache(record); throw new ConnectionError('Access denied: repository is not available through the selected installation and user.'); }
        try {
          if (cached !== undefined && gitRequest.operation !== 'gitRefs') return await readGit(gitRequest, repo.full_name, async () => cached);
          const result = await readGit(gitRequest, repo.full_name, (path, maxBytes) => this.api(record, path, maxBytes, gitRequest.operation === 'gitRefs' ? 'conditional' : 'immutable'));
          if (this.persistentCache && gitRequest.operation === 'gitBlob') verifiedGitBlobBytes(result as GitBlob);
          if (!isCurrent()) throw new ConnectionError('Document or connection access changed.');
          await this.persistentCache?.put(scope, resource, result);
          return result;
        }
        catch (error) { this.apiCache.clearConnection(record.id); throw error; }
      }
      if (request.operation !== 'repositories' && request.operation !== 'probe') throw new ConnectionError('Unsupported hosted operation.');
      return this.execute(request);
    }).then(value => {
      if (!isCurrent()) throw new ConnectionError('Document or connection access changed. Reconnect explicitly.');
      return value;
    });
    this.tail = result;
    return result;
  }

  private async dispatchReview(storage: ConnectionRecord, approved: ConnectionRecord[], repositoryName: string, receipt: ReviewReceipt, review: ReviewDeliveryRoute, isCurrent: () => boolean): Promise<ReviewReceipt> {
    const host = this.reviewDispatch;
    const key = JSON.stringify([repositoryName.toLowerCase(), review.workspace, receipt.resource, receipt.version, receipt.reviewer]);
    const previous = storage.reviewDeliveries?.[key];
    // Keep the first readback snapshot on same-response retries, even if Documents advanced.
    const exact: ReviewReceipt = previous ? { resource: previous.resource, version: previous.version, snapshot: previous.snapshot, reviewer: previous.reviewer } : { resource: receipt.resource, version: receipt.version, snapshot: receipt.snapshot, reviewer: receipt.reviewer };
    const target = `https://github.com/${host.repository}/actions/workflows/${host.workflow}`;
    const save = async (result: ReviewReceipt) => {
      storage.reviewDeliveries = { ...storage.reviewDeliveries, [key]: result };
      await this.store.put(storage);
      return result;
    };
    await save({ ...exact, dispatch: { state: 'pending', target, attempted_at: new Date(this.now()).toISOString() } });
    let attempted = false;
    try {
      const source = host.sourceConnectionId ? approved.find(item => item.id === host.sourceConnectionId) : storage;
      if (!source?.tokens || !source.user || source.user.id !== storage.user?.id || !source.installation) throw new ConnectionError('Missing trusted source-App connection for this authenticated reviewer. Response is saved.');
      const installation = (await this.installations(source)).find(item => item.id === source.installation!.id);
      const repository = (await this.repositories(source)).find(item => item.full_name.toLowerCase() === host.repository.toLowerCase());
      if (!installation || installation.permissions.actions !== 'write' || !repository) throw new ConnectionError('Missing installed-source Actions write route. Storage and source may use different Apps; configure the trusted source connection. Response is saved.');
      const process = review.process!;
      if (!isCurrent()) throw new ConnectionError('Document or connection access changed. Response is saved; reconnect before retrying delivery.');
      attempted = true;
      await this.api(source, `/repos/${host.repository}/actions/workflows/${encodeURIComponent(host.workflow)}/dispatches`, maxMetadataBytes, 'none', { method: 'POST', body: { ref: host.ref, inputs: { workspace: review.workspace, process: process.id, bead: review.bead_id, response: JSON.stringify(exact) } }, isCurrent });
      return await save({ ...exact, dispatch: { state: 'dispatched', target, attempted_at: new Date(this.now()).toISOString(), message: 'Dispatch accepted; workflow start and process progress are not yet known.' } });
    } catch (error) {
      return save({ ...exact, dispatch: { state: attempted && (error instanceof ConnectionTransportError || !(error instanceof ConnectionError)) ? 'unknown' : 'failed', target, attempted_at: new Date(this.now()).toISOString(), message: `Response is saved. ${error instanceof Error ? error.message : 'Delivery outcome unknown. Retry this saved response.'}` } });
    }
  }

  private state<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.catch(() => {}).then(work);
    this.tail = result;
    return result;
  }

  /** Serialize authority/token changes, not immutable native blob network I/O. */
  private async readNativeBlob(source: ReturnType<typeof loadedDocument>, request: Extract<GitRead, { operation: 'gitBlob' | 'gitBlobPart' }>, isCurrent: () => boolean) {
    const ticket = await this.state(async () => {
      if (!isCurrent()) throw new ConnectionError('Document or connection access changed.');
      const approved = (await this.store.all()).filter(record => hostedGrants(record).some(grant => matchesGrant(grant, source)));
      if (!approved.length) throw new ConnectionError('This document has no approved connections. Grant its origin and subpath access in connection settings and reload the page.');
      const record = approved.find(record => record.id === request.id);
      if (!record) throw new ConnectionError('This connection is not approved for the original document path.');
      if (!record.tokens || !record.user) throw new ConnectionError('Sign in before reading workspace data.');
      if (record.installation?.id !== request.installationId) throw new ConnectionError('The selected installation changed. Reconnect and rediscover workspaces; no fallback is allowed.');
      const repo = (await this.repositories(record)).find(repo => repo.full_name.toLowerCase() === request.repository.toLowerCase());
      if (!repo) { await this.retireCache(record); throw new ConnectionError('Access denied: repository is not available through the selected installation and user.'); }
      const token = await this.accessToken(record);
      if (!isCurrent()) throw new ConnectionError('Document or connection access changed.');
      const scope: CacheScope = { connection: record.id, account: record.user.id, installation: record.installation.id, generation: record.cacheGeneration, repository: repo.full_name, workspace: request.workspace, namespace: 'dolt' };
      const resource = `${request.operation}:${request.oid}`;
      let cached = request.operation === 'gitBlob' ? await this.persistentCache?.get(scope, resource, request.cacheVisit) : undefined;
      if (cached !== undefined) {
        try { cached = await readGit(request, repo.full_name, async () => cached); verifiedGitBlobBytes(cached as GitBlob); }
        catch { await this.persistentCache?.remove(scope, resource).catch(() => {}); cached = undefined; }
      }
      return { id: record.id, account: record.user.id, installation: record.installation.id, generation: record.cacheGeneration, token, scope, resource, cached, repository: repo.full_name };
    });
    // Called only on the serialized state lane, using fresh records. Never write
    // a pre-download record back after a concurrent refresh/revoke/disconnect.
    const authorize = async () => {
      if (!isCurrent()) throw new ConnectionError('Document or connection access changed.');
      const record = await this.store.get(ticket.id);
      if (!isCurrent() || !record?.tokens || record.user?.id !== ticket.account || record.installation?.id !== ticket.installation || record.cacheGeneration !== ticket.generation || !hostedGrants(record).some(grant => matchesGrant(grant, source))) throw new ConnectionError('Document or connection access changed. Reconnect explicitly.');
      return record;
    };
    const result = await readGit(request, ticket.repository, async (path, limit) => {
      if (ticket.cached !== undefined) return ticket.cached;
      const key = `${ticket.id}:${ticket.installation}:native:${ticket.generation ?? 0}:${path}`;
      const cached = this.apiCache.get(key);
      if (cached) return copyCacheValue(cached.value);
      if (!isCurrent()) throw new ConnectionError('Document or connection access changed.');
      const response = await this.send(`https://api.github.com${path}`, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${ticket.token}`, 'X-GitHub-Api-Version': '2022-11-28' } });
      try { await this.state(async () => {
        const record = await authorize(), records = await this.store.all();
        const related = records.filter(other => other.id === ticket.id || other.user?.id === ticket.account || other.apiCooldown?.scope === 'global');
        const cooldown = await responseCooldown(response, this.now(), Math.max(0, ...related.map(other => other.apiCooldown?.failures ?? 0)));
        for (const target of records) {
          if (cooldown && (cooldown.scope === 'global' || target.id === ticket.id || target.user?.id === ticket.account)) {
            target.apiCooldown = { ...cooldown, until: Math.max(cooldown.until, target.apiCooldown?.until ?? 0) }; await this.store.put(target);
          }
        }
        if (!response.ok) {
          if (cooldown) throw new ConnectionError(`GitHub API rate limit: retry after ${new Date(cooldown.until).toISOString()}. Retry manually after the cooldown.`);
          if ([401, 403, 404].includes(response.status)) await this.retireCache(record);
          throw new ConnectionError(`GitHub returned HTTP ${response.status}. Check access, authorization and rate limits.`);
        }
      }); } catch (error) { await response.body?.cancel().catch(() => {}); throw error; }
      let value: unknown;
      try { value = await boundedJSON(response, limit ?? maxMetadataBytes); }
      catch { throw new ConnectionError('GitHub returned an unreadable response or exceeded the read limit.'); }
      await this.state(async () => { await authorize(); this.apiCache.put(key, value, response.headers.get('etag') ?? undefined); });
      return value;
    }).catch(error => { this.apiCache.clearConnection(ticket.id); throw error; });
    return this.state(async () => {
      await authorize();
      if (request.operation === 'gitBlob' && this.persistentCache) { verifiedGitBlobBytes(result as GitBlob); await this.persistentCache.put(ticket.scope, ticket.resource, result); }
      if (!isCurrent()) throw new ConnectionError('Document or connection access changed.');
      return result;
    });
  }

  private async retireCache(record: ConnectionRecord) {
    record.cacheGeneration = (record.cacheGeneration ?? 0) + 1;
    await this.store.put(record);
    this.apiCache.clearConnection(record.id);
    // Generation changes prevent reuse even when physical cleanup fails.
    await this.persistentCache?.clearConnection(record.id).catch(() => {});
  }

  private async send(url: string, init: RequestInit) {
    let response: Response;
    try { response = await this.fetcher(url, { ...init, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: this.timeout(20000) }); }
    catch { throw new ConnectionTransportError('GitHub request failed or timed out. Retry when online.'); }
    return response;
  }

  private async json(url: string, init: RequestInit, maxBytes = maxMetadataBytes) {
    const response = await this.send(url, init);
    if (!response.ok) throw new ConnectionError(`GitHub returned HTTP ${response.status}. Check access, authorization and rate limits.`);
    try { return await boundedJSON(response, maxBytes) as any; }
    catch { throw new ConnectionError('GitHub returned an unreadable response or exceeded the read limit.'); }
  }

  private oauth(path: 'device/code' | 'oauth/access_token', parameters: Record<string, string>) {
    return this.json(`https://github.com/login/${path}`, {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(parameters).toString(),
    });
  }

  private async api(record: ConnectionRecord, path: string, maxBytes = maxMetadataBytes, cache: 'none' | 'conditional' | 'immutable' = 'conditional', mutation?: { method: 'POST' | 'PATCH'; body: unknown; isCurrent?: () => boolean }): Promise<unknown> {
    const records = await this.store.all();
    const related = records.filter(other => other.id === record.id || record.user && other.user?.id === record.user.id || other.apiCooldown?.scope === 'global');
    const until = Math.max(0, ...related.map(other => other.apiCooldown?.until ?? 0));
    if (until > this.now()) throw new ConnectionError(`GitHub API rate limit: retry after ${new Date(until).toISOString()}. No request was sent.`);
    const token = await this.accessToken(record);
    const key = `${record.id}:${record.installation?.id ?? 0}:${path}`;
    const diskScope: CacheScope = { connection: record.id, account: record.user?.id ?? 0, installation: record.installation?.id ?? 0, generation: record.cacheGeneration, repository: 'github-api', workspace: '', namespace: 'metadata' };
    const persisted = cache === 'conditional' && !mutation ? await this.persistentCache?.get(diskScope, path) : undefined;
    const disk = z.object({ value: z.unknown(), etag: z.string().max(8192).optional() }).safeParse(persisted);
    const cached = cache === 'none' ? undefined : this.apiCache.get(key) ?? (disk.success && disk.data.value !== undefined ? disk.data : undefined);
    if (cache === 'immutable' && cached) return copyCacheValue(cached.value);
    // Write authority may expire during storage reads or token rotation above.
    if (mutation?.isCurrent && !mutation.isCurrent()) throw new ConnectionError('Document or connection access changed. Reconnect explicitly before retrying.');
    const response = await this.send(`https://api.github.com${path}`, {
      ...(mutation ? { method: mutation.method, body: JSON.stringify(mutation.body) } : {}),
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(mutation ? { 'Content-Type': 'application/json' } : {}), ...(cache === 'conditional' && cached?.etag ? { 'If-None-Match': cached.etag } : {}) },
    });
    const cooldown = await responseCooldown(response, this.now(), Math.max(0, ...related.map(other => other.apiCooldown?.failures ?? 0)));
    // Keep the live record (possibly refreshed above) and persisted records in
    // sync. Device-flow tokens share the user's budget, not installation budgets.
    for (const other of records) {
      const target = other.id === record.id ? record : other;
      if (cooldown && (cooldown.scope === 'global' || target.id === record.id || record.user && target.user?.id === record.user.id)) {
        target.apiCooldown = { ...cooldown, until: Math.max(cooldown.until, target.apiCooldown?.until ?? 0) };
        await this.store.put(target);
      } else if (!cooldown && (response.ok || response.status === 304) && target.apiCooldown && target.apiCooldown.until <= this.now()) {
        delete target.apiCooldown; await this.store.put(target);
      }
    }
    if (!response.ok && cooldown) throw new ConnectionError(`GitHub API rate limit: retry after ${new Date(cooldown.until).toISOString()}. Retry manually after the cooldown.`);
    if (response.status === 304 && cached) return copyCacheValue(cached.value);
    if (!response.ok) {
      this.apiCache.clearConnection(record.id);
      if ([401, 403, 404].includes(response.status)) await this.retireCache(record);
      throw new ConnectionError(`GitHub returned HTTP ${response.status}. Check access, authorization and rate limits.`);
    }
    if (mutation && response.status === 204) return null;
    let value: unknown;
    try { value = await boundedJSON(response, maxBytes); }
    catch { throw new ConnectionError('GitHub returned an unreadable response or exceeded the read limit.'); }
    const etag = response.headers.get('etag') ?? undefined;
    if (cache !== 'none') this.apiCache.put(key, value, etag);
    if (cache === 'conditional' && !mutation) await this.persistentCache?.put(diskScope, path, { value, etag });
    return value;
  }

  private saveTokens(record: ConnectionRecord, data: unknown) {
    const parsed = tokenSchema.safeParse(data);
    if (!parsed.success) throw new ConnectionError('Expected expiring device-flow credentials. Enable expiring user tokens and device flow in the App settings.');
    const t = parsed.data;
    record.tokens = { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: this.now() + t.expires_in * 1000, refreshExpiresAt: this.now() + t.refresh_token_expires_in * 1000 };
    delete record.pending;
  }

  private async refresh(record: ConnectionRecord) {
    const tokens = record.tokens;
    if (!tokens?.refreshToken || !tokens.refreshExpiresAt || tokens.refreshExpiresAt <= this.now()) {
      throw new ConnectionError('Sign in again: no usable refresh token.');
    }
    const data = await this.oauth('oauth/access_token', { client_id: record.clientId, grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
    if (data.error) {
      if (['bad_refresh_token', 'invalid_grant', 'expired_token'].includes(data.error)) {
        delete record.tokens;
        await this.store.put(record);
      }
      throw new ConnectionError('Refresh did not succeed. Retry, or sign in again if authorization expired or was revoked.');
    }
    this.saveTokens(record, data);
    // Rotation invalidates the old pair. Persist the replacement before any API
    // call or response, not when the settings tab next happens to save.
    await this.store.put(record);
  }

  private async accessToken(record: ConnectionRecord) {
    if (!record.tokens) throw new ConnectionError('Sign in to this connection first.');
    if (record.tokens.expiresAt <= this.now() + 60000) await this.refresh(record);
    return record.tokens!.accessToken;
  }

  private async installations(record: ConnectionRecord) {
    const all: Installation[] = [];
    for (let page = 1; page <= 100; page++) {
      const data = z.object({ installations: z.array(installationSchema) }).parse(await this.api(record, `/user/installations?per_page=100&page=${page}`));
      all.push(...data.installations.filter(i => i.app_id === record.appId));
      if (data.installations.length < 100) return all;
    }
    throw new ConnectionError('Installation list exceeded the prototype limit; no partial list was selected.');
  }

  private async repositories(record: ConnectionRecord) {
    if (!record.installation) throw new ConnectionError('Select an installation first.');
    const all: Repository[] = [];
    for (let page = 1; page <= 100; page++) {
      const data = z.object({ repositories: z.array(repoSchema) }).parse(await this.api(record, `/user/installations/${record.installation.id}/repositories?per_page=100&page=${page}`, maxMetadataBytes, 'conditional'));
      all.push(...data.repositories);
      if (data.repositories.length < 100) return all;
    }
    throw new ConnectionError('Repository list exceeded the prototype limit; narrow the installation for this proof.');
  }

  private async execute(request: ConnectionRequest): Promise<unknown> {
    if (request.operation === 'cacheSettings' || request.operation === 'saveCacheSettings') {
      if (!this.persistentCache) throw new ConnectionError('Persistent workspace caching is unavailable in this host.');
      if (request.operation === 'saveCacheSettings') { await this.persistentCache.settings.save(request.settings); await this.persistentCache.trim(); }
      return { settings: await this.persistentCache.settings.read(), status: await this.persistentCache.status() };
    }
    if (request.operation === 'list') return (await this.store.all()).map(publicConnection);
    if (request.operation === 'add') {
      const record: ConnectionRecord = { id: this.newId(), name: request.name, appId: request.appId, clientId: request.clientId };
      await this.store.put(record);
      return publicConnection(record);
    }
    const record = await this.store.get(request.id);
    if (!record) throw new ConnectionError('Connection no longer exists.');
    switch (request.operation) {
      case 'remove': this.apiCache.clearConnection(record.id); await this.store.remove(record.id); await this.persistentCache?.clearConnection(record.id).catch(() => {}); return null;
      case 'disconnect':
        this.apiCache.clearConnection(record.id);
        delete record.tokens; delete record.pending; delete record.user; delete record.installation;
        delete record.origins;
        delete record.hostedGrants;
        delete record.recentNavigation;
        await this.retireCache(record); return publicConnection(record);
      case 'grantOrigin': {
        const origin = trustedOrigin(request.origin);
        const subpath = trustedSubpath(request.subpath);
        if (!record.tokens || !record.installation) throw new ConnectionError('Sign in and select an installation before granting hosted access.');
        const previous = request.replace && { origin: trustedOrigin(request.replace.origin), subpath: trustedSubpath(request.replace.subpath) };
        record.hostedGrants = hostedGrants(record).filter(grant => !previous || grant.origin !== previous.origin || grant.subpath !== previous.subpath);
        if (!record.hostedGrants.some(grant => grant.origin === origin && grant.subpath === subpath)) record.hostedGrants.push({ origin, subpath });
        delete record.origins;
        await this.store.put(record); return publicConnection(record);
      }
      case 'revokeOrigin':
        record.hostedGrants = hostedGrants(record).filter(grant => grant.origin !== trustedOrigin(request.origin) || grant.subpath !== trustedSubpath(request.subpath));
        delete record.origins;
        await this.retireCache(record); return publicConnection(record);
      case 'start': {
        if (record.tokens) throw new ConnectionError('Disconnect this connection before signing in again.');
        const data = z.object({ device_code: z.string().min(1), user_code: z.string().min(1), verification_uri: z.literal('https://github.com/login/device'), expires_in: z.number().positive(), interval: z.number().positive() })
          .parse(await this.oauth('device/code', { client_id: record.clientId, scope: 'offline_access' }));
        record.pending = { deviceCode: data.device_code, userCode: data.user_code, expiresAt: this.now() + data.expires_in * 1000, interval: Math.max(5, data.interval), nextPollAt: this.now() + Math.max(5, data.interval) * 1000 };
        await this.store.put(record); return publicConnection(record);
      }
      case 'poll': {
        const pending = record.pending;
        if (!pending) return publicConnection(record);
        if (pending.expiresAt <= this.now()) {
          delete record.pending; await this.store.put(record);
          throw new ConnectionError('Device code expired. Start sign-in again.');
        }
        if (pending.nextPollAt > this.now()) return publicConnection(record);
        pending.nextPollAt = this.now() + pending.interval * 1000;
        await this.store.put(record);
        const data = await this.oauth('oauth/access_token', { client_id: record.clientId, device_code: pending.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
        if (data.error === 'authorization_pending') return publicConnection(record);
        if (data.error === 'slow_down') {
          pending.interval += 5; pending.nextPollAt = this.now() + pending.interval * 1000;
          await this.store.put(record); return publicConnection(record);
        }
        if (data.error) {
          delete record.pending; await this.store.put(record);
          throw new ConnectionError('Device authorization was denied, expired, or unavailable. Check device flow is enabled and sign in again.');
        }
        this.saveTokens(record, data);
        await this.store.put(record);
        // Identity discovery is retriable independently of token issuance.
        record.user = z.object({ login: z.string(), id: z.number() }).parse(await this.api(record, '/user'));
        await this.store.put(record); return publicConnection(record);
      }
      case 'refresh': await this.refresh(record); return publicConnection(record);
      case 'installations': {
        if (!record.user) {
          record.user = z.object({ login: z.string(), id: z.number() }).parse(await this.api(record, '/user'));
          await this.store.put(record);
        }
        return this.installations(record);
      }
      case 'selectInstallation': {
        const installation = (await this.installations(record)).find(i => i.id === request.installationId);
        if (!installation) throw new ConnectionError('Installation is not available through this App and user.');
        // Check actual approved permissions, not merely what the client claims.
        if (Object.entries(installation.permissions).some(([key, value]) => value !== 'read' && value !== 'none' && !(['actions', 'contents'].includes(key) && value === 'write'))) {
          throw new ConnectionError('This client App supports write permissions only for Contents and Actions. Remove unrelated write permissions.');
        }
        this.apiCache.clearConnection(record.id);
        record.installation = { id: installation.id, account: installation.account.login };
        await this.retireCache(record); return publicConnection(record);
      }
      case 'repositories': return this.repositories(record);
      case 'probe': {
        const repo = (await this.repositories(record)).find(r => r.full_name.toLowerCase() === request.repository.toLowerCase());
        if (!repo) throw new ConnectionError('Repository is not available through the selected installation and user.');
        const [owner, name] = repo.full_name.split('/');
        const data = z.object({ object: z.object({ sha: z.string().regex(/^[a-f0-9]{40,64}$/), type: z.literal('commit') }) })
          .parse(await this.api(record, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/ref/heads/${repo.default_branch.split('/').map(encodeURIComponent).join('/')}`));
        return { ...repo, headOid: data.object.sha, checkedAt: new Date(this.now()).toISOString() };
      }
    }
  }
}
