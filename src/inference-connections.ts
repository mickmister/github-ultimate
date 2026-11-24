import { inferenceHostedSchema, inferenceSettingsSchema, inferenceURL, type InferenceConfiguration, type PublicInferenceConnection } from './inference-protocol';
import { loadedDocument, matchesGrant, trustedSubpath, type HostedGrant } from './hosted-access';
import { trustedOrigin } from './hosted-protocol';
import { boundedJSON } from './git-reads';
import { ConnectionError } from './connections';
import { utf8Bytes, UTF8Decoder } from './utf8';
import { ChatGPTAuthService, CHATGPT_INFERENCE_URL, chatgptEventStream, type ChatGPTAuth } from './chatgpt-auth';

export type InferenceRecord = InferenceConfiguration & { id: string; revision: string; hostedGrants: HostedGrant[]; chatgpt?: ChatGPTAuth };
export interface InferenceStore {
  all(): Promise<InferenceRecord[]>; get(id: string): Promise<InferenceRecord | undefined>;
  put(record: InferenceRecord): Promise<void>; remove(id: string): Promise<void>;
}
function publicRecord({ id, revision, name, model, hostedGrants, chatgpt }: InferenceRecord): PublicInferenceConnection {
  return { id, revision, name, model, hostedGrants, transport: 'http-stream-v1', ...(chatgpt ? { provider: 'chatgpt' as const, protocol: 'openai-codex-responses' as const, authStatus: chatgpt.pending && !chatgpt.pending.exchanging && chatgpt.pending.expires > Date.now() ? 'connecting' as const : chatgpt.access && !chatgpt.refreshing ? 'connected' as const : 'disconnected' as const } : {}) };
}

/** The endpoint and secret headers are extension settings, never page inputs. */
export class InferenceConnections {
  private active = new Map<string, { controller: AbortController; document: string; id: string }>();
  private streams = new Map<string, { key: string; reader: ReadableStreamDefaultReader<Uint8Array>; decoder: UTF8Decoder; remainder: string; bytes: number; sequence: number; reading: boolean; timer: ReturnType<typeof setTimeout> }>();
  private cancelled = new Map<string, number>();
  private tail: Promise<unknown> = Promise.resolve();
  private epoch = 0;
  private chatgpt: ChatGPTAuthService;
  constructor(private store: InferenceStore, private fetcher: typeof fetch = (...args) => fetch(...args), private hasHostAccess: (origin: string) => Promise<boolean> = async () => true, private newId: () => string = () => crypto.randomUUID(), private timeout = (ms: number) => AbortSignal.timeout(ms), private combine = (signals: AbortSignal[]) => AbortSignal.any(signals)) { this.chatgpt = new ChatGPTAuthService(store, fetcher, hasHostAccess); }
  private serial<T>(work: () => Promise<T>) { const next = this.tail.catch(() => {}).then(work); this.tail = next; return next; }
  cancelActive() { for (const [id, job] of this.active) { job.controller.abort(); this.closeStream(id); } }
  private closeStream(id: string) {
    const stream = this.streams.get(id);
    if (!stream) return;
    clearTimeout(stream.timer); this.streams.delete(id); this.active.delete(id);
    void stream.reader.cancel().catch(() => {});
  }
  handle(input: unknown) {
    const request = inferenceSettingsSchema.parse(input);
    if (request.operation !== 'list' && request.operation !== 'chatgptPoll') {
      this.epoch++;
      this.cancelActive();
    }
    return this.serial(() => this.executeSettings(request));
  }
  private async executeSettings(request: ReturnType<typeof inferenceSettingsSchema.parse>) {
    if (request.operation === 'list') return (await this.store.all()).map(publicRecord);
    if (request.operation === 'chatgptAdd') {
      await this.chatgpt.permission();
      const record: InferenceRecord = { id: this.newId(), revision: this.newId(), name: request.name, model: request.model, url: CHATGPT_INFERENCE_URL, headers: [], hostedGrants: [], chatgpt: {} };
      await this.store.put(record); return publicRecord(record);
    }
    if (request.operation === 'add') {
      if (!await this.hasHostAccess(inferenceURL(request.url).origin)) throw new ConnectionError('Grant browser access to the inference endpoint first.');
      const { operation: _, ...config } = request;
      const record: InferenceRecord = { ...config, id: this.newId(), revision: this.newId(), hostedGrants: [] };
      await this.store.put(record); return publicRecord(record);
    }
    const record = await this.store.get(request.id);
    if (!record) throw new ConnectionError('Inference connection no longer exists.');
    if (request.operation === 'remove') { await this.store.remove(record.id); return null; }
    if (request.operation.startsWith('chatgpt')) {
      if (!record.chatgpt) throw new ConnectionError('This is not a ChatGPT connection.');
      if (request.operation === 'chatgptStart') return this.chatgpt.start(record);
      if (request.operation === 'chatgptPoll') {
        const revision = record.revision, result = await this.chatgpt.poll(record);
        if (record.revision !== revision) { this.epoch++; this.cancelActive(); }
        return result;
      }
      if (request.operation === 'chatgptCancel') delete record.chatgpt.pending;
      if (request.operation === 'chatgptDisconnect') record.chatgpt = {};
      if (request.operation === 'chatgptModel') record.model = request.model;
      record.revision = this.newId(); await this.store.put(record); return publicRecord(record);
    }
    if (request.operation !== 'grantOrigin' && request.operation !== 'revokeOrigin') throw new ConnectionError('Unknown inference settings operation.');
    const grant = { origin: trustedOrigin(request.origin), subpath: trustedSubpath(request.subpath) };
    record.hostedGrants = record.hostedGrants.filter(item => item.origin !== grant.origin || item.subpath !== grant.subpath);
    if (request.operation === 'grantOrigin') record.hostedGrants.push(grant);
    record.revision = this.newId();
    await this.store.put(record); return publicRecord(record);
  }
  async handleHosted(documentURL: string, input: unknown, current: () => boolean = () => true) {
    const source = loadedDocument(documentURL), request = inferenceHostedSchema.parse(input), epoch = this.epoch;
    const approved = (await this.store.all()).filter(record => record.hostedGrants.some(grant => matchesGrant(grant, source)));
    if (!current()) throw new ConnectionError('Inference document changed.');
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
      if (job?.document === source.href && job.id === record.id) { job.controller.abort(); this.closeStream(request.requestId); }
      return null;
    }
    const url = inferenceURL(record.chatgpt ? CHATGPT_INFERENCE_URL : record.url);
    if (!await this.hasHostAccess(url.origin) || !await this.hasHostAccess(source.origin) || !current() || epoch !== this.epoch) throw new ConnectionError('Inference endpoint or page access changed.');
    if (this.cancelled.has(key)) throw new ConnectionError('Inference cancelled.');
    if (request.operation === 'inferenceRead') {
      const stream = this.streams.get(request.requestId), job = this.active.get(request.requestId);
      if (!stream || stream.key !== key || !job) throw new ConnectionError('Inference stream expired or access changed.');
      if (stream.reading || stream.sequence !== request.sequence) throw new ConnectionError('Inference stream read order mismatch.');
      stream.reading = true;
      try {
        let done = false;
        if (!stream.remainder) {
          const part = await stream.reader.read(); done = part.done;
          stream.bytes += part.value?.byteLength ?? 0;
          if (stream.bytes > 2 * 1024 * 1024) throw new ConnectionError('Inference response exceeds 2 MiB.');
          stream.remainder = stream.decoder.decode(part.value, { stream: !done });
        }
        if (!await this.hasHostAccess(url.origin) || !await this.hasHostAccess(source.origin) || !current() || job.controller.signal.aborted || epoch !== this.epoch) throw new ConnectionError('Inference cancelled or access changed.');
        // Pull-based reads keep only one provider chunk in memory. Bound each
        // JSON reply too, including native bridge transfers and UTF-16 pairs.
        let end = Math.min(stream.remainder.length, 16384);
        if (end < stream.remainder.length && /[\uD800-\uDBFF]/.test(stream.remainder[end - 1])) end--;
        const text = stream.remainder.slice(0, end); stream.remainder = stream.remainder.slice(end);
        stream.sequence++; stream.reading = false;
        if (done) this.closeStream(request.requestId);
        return { text, done };
      } catch {
        job.controller.abort(); this.closeStream(request.requestId);
        throw new ConnectionError('Inference stream failed, was cancelled, timed out or exceeded the response limit.');
      }
    }
    if (this.active.size >= 2 || this.active.has(request.requestId)) throw new ConnectionError('Inference is busy or this request is already active.');
    let body: Record<string, unknown>;
    if (utf8Bytes(request.body) > 1024 * 1024) throw new ConnectionError('Inference request exceeds 1 MiB.');
    try { body = JSON.parse(request.body); } catch { throw new ConnectionError('Invalid inference JSON.'); }
    const allowed = record.chatgpt ? ['input', 'instructions', 'tools', 'tool_choice', 'model', 'stream', 'store', 'reasoning', 'text', 'include', 'parallel_tool_calls', 'prompt_cache_key'] : request.operation === 'inferenceOpen'
      ? ['messages', 'tools', 'tool_choice', 'model', 'stream', 'stream_options', 'store', 'max_tokens', 'max_completion_tokens', 'temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'stop', 'reasoning_effort', 'parallel_tool_calls']
      : ['messages', 'tools'];
    if (!body || Array.isArray(body) || typeof body !== 'object' || !Array.isArray(body[record.chatgpt ? 'input' : 'messages']) || !(body[record.chatgpt ? 'input' : 'messages'] as unknown[]).length || Object.keys(body).some(key => !allowed.includes(key))) throw new ConnectionError('Expected messages and optional tools or supported sampling options only.');
    if (record.chatgpt && request.operation !== 'inferenceOpen') throw new ConnectionError('ChatGPT requires an updated hosted app with Responses streaming support.');
    const controller = new AbortController();
    let response: Response | undefined;
    let secrets: string[] = [];
    this.active.set(request.requestId, { controller, document: source.href, id: record.id });
    try {
      const headers = new Headers();
      if (record.chatgpt) {
        const credentials = await this.serial(async () => {
          const latest = await this.store.get(record.id);
          if (!latest?.chatgpt || latest.revision !== request.revision || epoch !== this.epoch || controller.signal.aborted || !current()) throw new ConnectionError('ChatGPT access changed. Reconnect explicitly.');
          return this.chatgpt.credentials(latest);
        });
        if (epoch !== this.epoch || controller.signal.aborted || !current() || !await this.hasHostAccess(source.origin) || !await this.hasHostAccess(url.origin)) throw new ConnectionError('Inference cancelled or access changed.');
        headers.set('Authorization', `Bearer ${credentials.access}`); headers.set('ChatGPT-Account-Id', credentials.accountId);
        secrets = [credentials.access, credentials.refresh];
        headers.set('OpenAI-Beta', 'responses=experimental'); headers.set('originator', 'pi'); headers.set('Accept', 'text/event-stream');
      } else for (const header of record.headers) headers.set(header.name, header.value);
      headers.set('Content-Type', 'application/json');
      const payload: Record<string, unknown> = { ...body, model: record.model, stream: request.operation === 'inferenceOpen' };
      if (request.operation === 'inferenceOpen') payload.store = false;
      if (!record.chatgpt) {
        const tokenField = 'max_completion_tokens' in body ? 'max_completion_tokens' : 'max_tokens';
        if ('max_completion_tokens' in body) delete payload.max_tokens;
        payload[tokenField] = typeof body[tokenField] === 'number' ? Math.max(1, Math.min(4096, Math.floor(body[tokenField]))) : 4096;
      }
      const signal = this.combine([controller.signal, this.timeout(90000)]);
      response = await this.fetcher(url.href, { method: 'POST', headers, body: JSON.stringify(payload), credentials: 'omit', redirect: 'error', cache: 'no-store', signal });
      if (request.operation === 'inferenceOpen') {
        if (!await this.hasHostAccess(url.origin) || !await this.hasHostAccess(source.origin) || !current() || signal.aborted || epoch !== this.epoch) throw new ConnectionError('Inference cancelled or access changed.');
        // Error bodies may reflect credentials. Preserve HTTP semantics without
        // forwarding provider diagnostics or arbitrary response headers.
        const status = response.status;
        const retryAfter = response.headers.get('retry-after');
        const exposed: Record<string, string> = {};
        if (retryAfter && /^\d{1,5}$/.test(retryAfter)) exposed['retry-after'] = retryAfter;
        if (!response.ok) {
          await response.body?.cancel();
          const message = record.chatgpt
            ? status === 401 ? 'ChatGPT authorization was rejected. Reconnect in extension settings.'
              : status === 429 ? 'ChatGPT usage or rate limit reached. Check your ChatGPT plan and limits.'
                : status === 403 ? 'ChatGPT access is unavailable for this account or workspace. Check its permissions and plan.'
                  : `ChatGPT returned HTTP ${status}. Retry later or check the connection in extension settings.`
            : `Inference returned HTTP ${status}. Check the endpoint and configured headers.`;
          return { status, headers: { ...exposed, 'content-type': 'application/json' }, body: JSON.stringify({ error: { message } }) };
        }
        const reader = (record.chatgpt && response.body ? chatgptEventStream(response.body, secrets) : response.body)?.getReader();
        if (!reader) throw new ConnectionError('Inference response has no body.');
        const timer = setTimeout(() => { controller.abort(); this.closeStream(request.requestId); }, 90000);
        this.streams.set(request.requestId, { key, reader, decoder: new UTF8Decoder(), remainder: '', bytes: 0, sequence: 0, reading: false, timer });
        signal.addEventListener('abort', () => { controller.abort(); this.closeStream(request.requestId); }, { once: true });
        if (signal.aborted) { this.closeStream(request.requestId); throw new ConnectionError('Inference cancelled.'); }
        const contentType = response.headers.get('content-type');
        if (contentType) exposed['content-type'] = contentType.startsWith('text/event-stream') ? 'text/event-stream' : 'application/json';
        return { status, headers: exposed };
      }
      if (!response.ok) { await response.body?.cancel(); throw new ConnectionError(`Inference returned HTTP ${response.status}. Check the endpoint and configured headers.`); }
      const result = await boundedJSON(response, 2 * 1024 * 1024);
      if (!await this.hasHostAccess(url.origin) || !await this.hasHostAccess(source.origin) || !current() || controller.signal.aborted || epoch !== this.epoch) throw new ConnectionError('Inference cancelled or access changed.');
      return result;
    } catch (error) {
      await response?.body?.cancel().catch(() => {});
      // Provider error bodies and fetch errors can contain credentials or URLs.
      if (error instanceof ConnectionError) throw error;
      throw new ConnectionError('Inference failed, was cancelled, timed out or exceeded the response limit.');
    } finally { if (!this.streams.has(request.requestId)) this.active.delete(request.requestId); }
  }
}
