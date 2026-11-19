import { inferenceHostedSchema, inferenceSettingsSchema, inferenceURL, type InferenceConfiguration, type PublicInferenceConnection } from './inference-protocol';
import { loadedDocument, matchesGrant, trustedSubpath, type HostedGrant } from './hosted-access';
import { trustedOrigin } from './hosted-protocol';
import { boundedJSON } from './git-reads';
import { ConnectionError } from './connections';

export type InferenceRecord = InferenceConfiguration & { id: string; revision: string; hostedGrants: HostedGrant[] };
export interface InferenceStore {
  all(): Promise<InferenceRecord[]>; get(id: string): Promise<InferenceRecord | undefined>;
  put(record: InferenceRecord): Promise<void>; remove(id: string): Promise<void>;
}
function publicRecord({ id, revision, name, model, hostedGrants }: InferenceRecord): PublicInferenceConnection {
  return { id, revision, name, model, hostedGrants };
}

/** The endpoint and secret headers are extension settings, never page inputs. */
export class InferenceConnections {
  private active = new Map<string, { controller: AbortController; document: string; id: string }>();
  private cancelled = new Map<string, number>();
  private tail: Promise<unknown> = Promise.resolve();
  private epoch = 0;
  constructor(private store: InferenceStore, private fetcher: typeof fetch = (...args) => fetch(...args), private hasHostAccess: (origin: string) => Promise<boolean> = async () => true) {}
  handle(input: unknown) {
    const request = inferenceSettingsSchema.parse(input);
    if (request.operation !== 'list') {
      this.epoch++;
      for (const job of this.active.values()) job.controller.abort();
    }
    const work = this.tail.catch(() => {}).then(() => this.executeSettings(request));
    this.tail = work; return work;
  }
  private async executeSettings(request: ReturnType<typeof inferenceSettingsSchema.parse>) {
    if (request.operation === 'list') return (await this.store.all()).map(publicRecord);
    if (request.operation === 'add') {
      if (!await this.hasHostAccess(inferenceURL(request.url).origin)) throw new ConnectionError('Grant browser access to the inference endpoint first.');
      const { operation: _, ...config } = request;
      const record: InferenceRecord = { ...config, id: crypto.randomUUID(), revision: crypto.randomUUID(), hostedGrants: [] };
      await this.store.put(record); return publicRecord(record);
    }
    const record = await this.store.get(request.id);
    if (!record) throw new ConnectionError('Inference connection no longer exists.');
    if (request.operation === 'remove') { await this.store.remove(record.id); return null; }
    const grant = { origin: trustedOrigin(request.origin), subpath: trustedSubpath(request.subpath) };
    record.hostedGrants = record.hostedGrants.filter(item => item.origin !== grant.origin || item.subpath !== grant.subpath);
    if (request.operation === 'grantOrigin') record.hostedGrants.push(grant);
    record.revision = crypto.randomUUID();
    await this.store.put(record); return publicRecord(record);
  }
  async handleHosted(documentURL: string, input: unknown) {
    const source = loadedDocument(documentURL), request = inferenceHostedSchema.parse(input), epoch = this.epoch;
    const approved = (await this.store.all()).filter(record => record.hostedGrants.some(grant => matchesGrant(grant, source)));
    if (request.operation === 'inferenceConnections') return approved.map(publicRecord);
    const record = approved.find(record => record.id === request.id);
    if (!record || record.revision !== request.revision) throw new ConnectionError('Inference connection access changed. Reconnect explicitly.');
    const key = JSON.stringify([source.href, record.id, record.revision, request.requestId]);
    for (const [key, until] of this.cancelled) if (until < Date.now()) this.cancelled.delete(key);
    if (request.operation === 'inferenceCancel') {
      // Retain a bounded tombstone so Stop can overtake async authorization of
      // the corresponding completion without letting it start afterwards.
      if (this.cancelled.size >= 128) this.cancelled.delete(this.cancelled.keys().next().value!);
      this.cancelled.set(key, Date.now() + 120000);
      const job = this.active.get(request.requestId);
      if (job?.document === source.href && job.id === record.id) job.controller.abort();
      return null;
    }
    const url = inferenceURL(record.url);
    if (!await this.hasHostAccess(url.origin) || !await this.hasHostAccess(source.origin) || epoch !== this.epoch) throw new ConnectionError('Inference endpoint or page access changed.');
    if (this.cancelled.has(key)) throw new ConnectionError('Inference cancelled.');
    if (this.active.size >= 2 || this.active.has(request.requestId)) throw new ConnectionError('Inference is busy or this request is already active.');
    let body: Record<string, unknown>;
    if (new TextEncoder().encode(request.body).length > 1024 * 1024) throw new ConnectionError('Inference request exceeds 1 MiB.');
    try { body = JSON.parse(request.body); } catch { throw new ConnectionError('Invalid inference JSON.'); }
    if (!body || Array.isArray(body) || typeof body !== 'object' || !Array.isArray(body.messages) || !body.messages.length || Object.keys(body).some(key => !['messages', 'tools'].includes(key))) throw new ConnectionError('Expected messages and optional tools only.');
    const controller = new AbortController();
    let response: Response | undefined;
    this.active.set(request.requestId, { controller, document: source.href, id: record.id });
    try {
      const headers = new Headers();
      for (const header of record.headers) headers.set(header.name, header.value);
      headers.set('Content-Type', 'application/json');
      response = await this.fetcher(url.href, { method: 'POST', headers, body: JSON.stringify({ ...body, model: record.model, stream: false, max_tokens: 4096 }), credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]) });
      if (!response.ok) { await response.body?.cancel(); throw new ConnectionError(`Inference returned HTTP ${response.status}. Check the endpoint and configured headers.`); }
      const result = await boundedJSON(response, 2 * 1024 * 1024);
      if (controller.signal.aborted || epoch !== this.epoch || !await this.hasHostAccess(url.origin) || !await this.hasHostAccess(source.origin)) throw new ConnectionError('Inference cancelled or access changed.');
      return result;
    } catch (error) {
      await response?.body?.cancel().catch(() => {});
      // Provider error bodies and fetch errors can contain credentials or URLs.
      if (error instanceof ConnectionError) throw error;
      throw new ConnectionError('Inference failed, was cancelled, timed out or exceeded the response limit.');
    } finally { this.active.delete(request.requestId); }
  }
}
