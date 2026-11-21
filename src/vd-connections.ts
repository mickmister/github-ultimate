import { z } from 'zod';
import { loadedDocument, matchesGrant, trustedSubpath, type HostedGrant } from './hosted-access';
import { trustedOrigin } from './hosted-protocol';
import { vdSettingsSchema, type VdDraft, type VdHeader, type PublicVdConnection } from './vd-protocol';
import type { ReviewReceipt, ReviewRequest } from './review-protocol';
import { utf8Text } from './utf8';

export type VdRecord = Omit<PublicVdConnection, 'headers'> & { headers: VdHeader[] };
export interface VdStore {
  all(): Promise<VdRecord[]>;
  get(id: string): Promise<VdRecord | undefined>;
  put(record: VdRecord): Promise<void>;
  remove(id: string): Promise<void>;
  delivery(key: string): Promise<ReviewReceipt | undefined>;
  saveDelivery(key: string, receipt: ReviewReceipt): Promise<void>;
}
export class VdError extends Error {}
const sessionSchema = z.object({ id: z.string().uuid(), workspace_id: z.string().uuid(), executor: z.string().min(1).max(100) });
const queueSchema = z.discriminatedUnion('status', [z.object({ status: z.literal('empty') }), z.object({ status: z.literal('queued') })]);
const summary = ({ headers, ...record }: VdRecord): PublicVdConnection => ({ ...record, headers: headers.map(({ name, mode, value }) => ({ name, mode, configured: Boolean(value), ...(mode === 'plaintext' ? { value } : {}) })) });
function redact(text: string, record: VdRecord) {
  const values = record.headers.filter(header => header.mode === 'secret').flatMap(header => {
    const raw = header.value, credential = /^(?:proxy-)?authorization$/i.test(header.name) ? raw.replace(/^(?:Bearer|Basic)\s+/i, '') : raw;
    return [raw, credential].filter(Boolean).flatMap(value => [value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)]);
  }).sort((a, b) => b.length - a.length);
  const safe = values.reduce((out, value) => out.split(value).join('[secret]'), text).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  return safe.length > 4000 ? safe.slice(0, 4000) + '\n[Truncated]' : safe;
}

/** Privileged host only: hosted requests never choose an origin, headers or prompt. */
export class VdConnections {
  private tail: Promise<unknown> = Promise.resolve();
  private epoch = 0;
  constructor(private store: VdStore, private fetcher: typeof fetch = (...args) => fetch(...args), private hasHostAccess: (origin: string) => Promise<boolean> = async () => true, private newId: () => string = () => crypto.randomUUID()) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.catch(() => {}).then(work); this.tail = result; return result;
  }
  async publicConnections(documentURL: string) {
    const source = loadedDocument(documentURL);
    return (await this.store.all()).filter(record => record.hostedGrants.some(grant => matchesGrant(grant, source))).map(summary);
  }
  private async resolve(draft: VdDraft): Promise<VdRecord> {
    const previous = draft.id ? await this.store.get(draft.id) : undefined;
    if (draft.id && !previous) throw new VdError('VD connection no longer exists.');
    const seen = new Set<string>();
    const headers = draft.headers.map(header => {
      const name = header.name.toLowerCase();
      if (seen.has(name) || ['host', 'content-length', 'connection', 'cookie', 'origin', 'referer', 'proxy-authorization'].includes(name) || name.startsWith('sec-')) throw new VdError('Header names must be unique and supported by the client transport.');
      seen.add(name);
      const old = previous?.headers.find(item => item.name.toLowerCase() === name);
      if (old && (old.mode !== header.mode || previous?.origin !== draft.origin) && !header.value?.trim()) throw new VdError('Enter a non-empty replacement header value when changing mode or VD origin.');
      if (header.value === undefined && (!old || old.mode !== header.mode || previous?.origin !== draft.origin)) throw new VdError('Enter a replacement header value when changing mode or VD origin.');
      return { name, mode: header.mode, value: header.value ?? old!.value };
    });
    return { ...draft, id: previous?.id ?? this.newId(), revision: this.newId(), headers, hostedGrants: previous?.hostedGrants ?? [] };
  }
  handle(input: unknown): Promise<unknown> {
    const parsed = vdSettingsSchema.safeParse(input);
    if (!parsed.success) return Promise.reject(new VdError('Invalid VD settings. Check the origin, workspace IDs and headers.'));
    const request = parsed.data;
    if (request.operation !== 'list' && request.operation !== 'test') this.epoch++;
    return this.serial(async () => {
      if (request.operation === 'list') return (await this.store.all()).map(summary);
      if ('draft' in request) {
        const record = await this.resolve(request.draft);
        if (!await this.hasHostAccess(record.origin)) throw new VdError('Grant browser host access to the VD origin first.');
        if (request.operation === 'test') {
          const data = await this.api(record, '/api/workspaces', undefined, true);
          const result = z.array(z.object({ id: z.string() })).safeParse(data);
          if (!result.success) throw new VdError('VD returned an unexpected workspace list.');
          if (!result.data.some(workspace => workspace.id === record.workspaceId)) throw new VdError('VD connected, but the configured workspace is not visible.');
          return { message: `VD connection succeeded. ${result.data.length} workspace(s) visible; configured workspace found.` };
        }
        await this.store.put(record); return summary(record);
      }
      const record = await this.store.get(request.id);
      if (!record) throw new VdError('VD connection no longer exists.');
      if (request.operation === 'remove') { await this.store.remove(record.id); return null; }
      const grant: HostedGrant = { origin: trustedOrigin(request.origin), subpath: trustedSubpath(request.subpath) };
      record.hostedGrants = record.hostedGrants.filter(item => item.origin !== grant.origin || item.subpath !== grant.subpath);
      if (request.operation === 'grantOrigin') record.hostedGrants.push(grant);
      record.revision = this.newId(); await this.store.put(record); return summary(record);
    });
  }
  deliver(documentURL: string, repository: string, receipt: ReviewReceipt, review: ReviewRequest, current: () => boolean): Promise<ReviewReceipt> {
    const epoch = this.epoch;
    return this.serial(async () => {
      const effect = review.response_effect;
      if (!effect || review.process) return receipt;
      const source = loadedDocument(documentURL);
      const candidates = (await this.store.all()).filter(record => record.repository.toLowerCase() === repository.toLowerCase() && record.workspace === review.workspace && record.workspaceId === effect.workspace_id && record.hostedGrants.some(grant => matchesGrant(grant, source)));
      if (candidates.length !== 1) return { ...receipt, dispatch: { kind: 'vk', state: 'pending', message: 'Response saved. Configure exactly one matching VD connection and hosted continuation grant in extension/native settings, then retry this saved response.' } };
      const record = candidates[0];
      // Connection revisions/IDs are deliberately NOT part of replay identity:
      // credential rotation or removing/readding a profile must not resend work.
      const key = JSON.stringify([repository.toLowerCase(), review.workspace, receipt.resource, receipt.version, receipt.reviewer, effect.workspace_id, effect.session_id]);
      const previous = await this.store.delivery(key);
      if (previous?.dispatch?.state === 'dispatched' || previous?.dispatch?.state === 'unknown') {
        if (!current() || epoch !== this.epoch) return { ...receipt, dispatch: { kind: 'vk', state: 'pending', message: 'Response saved. Connection authority changed; reconnect before reading delivery evidence.' } };
        return previous;
      }
      const exact = previous ? { resource: previous.resource, version: previous.version, snapshot: previous.snapshot, reviewer: previous.reviewer } : receipt;
      const target = `${record.origin}/workspaces/${encodeURIComponent(effect.workspace_id)}`;
      const save = async (dispatch: NonNullable<ReviewReceipt['dispatch']>) => {
        const result = { ...exact, dispatch: { kind: 'vk' as const, target, attempted_at: new Date().toISOString(), ...dispatch } };
        await this.store.saveDelivery(key, result); return result;
      };
      let attempted = false;
      const requireCurrent = async () => {
        if (!current() || epoch !== this.epoch || !await this.hasHostAccess(record.origin)) throw new VdError('VD connection or hosted authority changed. Response is saved.');
      };
      try {
        await requireCurrent();
        const path = `/api/sessions/${encodeURIComponent(effect.session_id)}`;
        const session = sessionSchema.parse(await this.api(record, path));
        if (session.id !== effect.session_id || session.workspace_id !== effect.workspace_id) throw new VdError('VD session does not belong to the configured workspace. No fallback was used.');
        const workspaces = z.array(z.object({ id: z.string(), archived: z.boolean().optional(), worktree_deleted: z.boolean().optional() })).parse(await this.api(record, '/api/workspaces'));
        if (!workspaces.some(item => item.id === effect.workspace_id && !item.archived && !item.worktree_deleted)) throw new VdError('VD workspace is missing, archived or deleted.');
        const queue = queueSchema.parse(await this.api(record, `${path}/queue`));
        if (queue.status === 'queued') return save({ state: 'pending', message: 'Response saved. The VD queue already contains a message. Resolve it in VD, then retry; nothing was overwritten.' });
        const activity = z.object({ session_id: z.string().uuid(), has_running_turn: z.boolean() }).parse(await this.api(record, `${path}/conversation-preview?limit=1`));
        if (activity.session_id !== effect.session_id) throw new VdError('VD activity returned a different session.');
        const prompt = `[review-response:${receipt.version}]\nA content review response was submitted. Read and validate the exact request, forms, answers and comments before continuing. Discussion feedback does not authorize code changes.\nStorage repository: ${repository}\nNugs workspace: ${review.workspace}\nBead: ${review.bead_id}\nRequest resource: review-requests/${review.request_id}/request.json\nResponse: ${receipt.resource}\nResponse blob: ${receipt.version}\nResponse snapshot: ${exact.snapshot}\nThe response contains the authoritative request version and snapshot. Use those exact pins; do not substitute the latest request.`;
        await save({ state: 'unknown', message: 'VD submission intent saved. If interrupted, inspect the destination before any manual resend.' });
        // Final queue/authority check after the durable journal, before mutation.
        if (queueSchema.parse(await this.api(record, `${path}/queue`)).status !== 'empty') return save({ state: 'pending', message: 'Response saved. VD queue changed before submission; retry after resolving it.' });
        await requireCurrent();
        attempted = true;
        const result = await this.api(record, path + (activity.has_running_turn ? '/queue' : '/follow-up'), activity.has_running_turn
          ? { message: prompt, executor_config: { executor: session.executor } }
          : { prompt, executor_config: { executor: session.executor }, retry_process_id: null, force_when_dirty: null, perform_git_reset: null });
        const process = !activity.has_running_turn ? z.object({ id: z.string().uuid(), session_id: z.literal(effect.session_id) }).parse(result) : undefined;
        if (activity.has_running_turn) z.object({ status: z.literal('queued') }).parse(result);
        return await save({ state: 'dispatched', process_id: process?.id, queued: activity.has_running_turn, message: activity.has_running_turn ? 'VD accepted the queued notification. Queue acceptance does not prove execution; its single-slot queue can still be replaced by another client.' : 'VD accepted the session follow-up. Acceptance does not prove review processing is complete.' });
      } catch (error) {
        return save({ state: attempted ? 'unknown' : 'failed', message: attempted ? 'Response saved; VD submission outcome is uncertain. Inspect the destination for the delivery marker before resending. Automatic replay is suppressed.' : error instanceof VdError ? error.message : 'VD response or credential storage is unavailable. Response is saved; check settings and retry.' });
      }
    });
  }
  private async api(record: VdRecord, path: string, body?: unknown, diagnostics = false): Promise<unknown> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await this.fetcher(record.origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...Object.fromEntries(record.headers.map(header => [header.name.toLowerCase(), header.value])) }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store' });
      const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      if (reader) try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 1024 * 1024) { await reader.cancel(); throw new VdError('VD response exceeded 1 MiB.'); } chunks.push(value); } } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const text = utf8Text(bytes);
      const details = diagnostics ? redact(`HTTP ${response.status}\n${['www-authenticate', 'x-request-id', 'content-type'].map(name => `${name}: ${response.headers.get(name) ?? ''}`).join('\n')}\n${text}`, record) : `VD returned HTTP ${response.status}.`;
      if (!response.ok || response.redirected) throw new VdError(details);
      let envelope: { success?: boolean; data?: unknown };
      try { envelope = JSON.parse(text); } catch { throw new VdError(diagnostics ? details : 'VD returned unexpected non-JSON data.'); }
      if (!envelope || envelope.success !== true || !('data' in envelope)) throw new VdError(diagnostics ? details : 'VD rejected the request.');
      return envelope.data;
    } catch (error) {
      if (error instanceof VdError) throw error;
      throw new VdError(diagnostics ? redact(controller.signal.aborted ? 'VD connection timed out after 20 seconds.' : `VD network request failed: ${error instanceof Error ? error.message : 'Unavailable'}`, record) : 'VD request failed or timed out.');
    } finally { clearTimeout(timer); }
  }
}
