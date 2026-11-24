import { z } from 'zod';
import { boundedJSON } from './git-reads';
import { ConnectionError } from './connections';
import type { InferenceRecord, InferenceStore } from './inference-connections';

// Codex device protocol, matching pinned Pi 1.5.2 auth/oauth/openai-codex.ts.
// This is distinct from OSS dynamic-agent registration/public Responses OAuth.
export const CHATGPT_ORIGINS = ['https://auth.openai.com', 'https://chatgpt.com'];
export const CHATGPT_INFERENCE_URL = 'https://chatgpt.com/backend-api/codex/responses';
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const VERIFY_URL = 'https://auth.openai.com/codex/device';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const string = z.string().min(1).max(32000);
const deviceSchema = z.object({ device_auth_id: string, user_code: z.string().min(1).max(100), interval: z.union([z.number(), z.string()]).transform(Number).pipe(z.number().finite().nonnegative().max(900)) });
const tokenSchema = z.object({ access_token: string, refresh_token: string, expires_in: z.number().finite().positive().max(365 * 86400) });
export type ChatGPTAuth = {
  access?: string; refresh?: string; expires?: number; accountId?: string;
  refreshing?: boolean;
  pending?: { deviceId: string; userCode: string; interval: number; nextPoll: number; expires: number; exchanging?: boolean };
};
export type ChatGPTSignIn = { verificationUrl: string; userCode: string; expiresAt: number; pollAfterMs: number } | null;

/** Called only under the broker's settings/credential mutex. Pending device IDs,
 * verifiers and rotating credentials never enter hosted descriptors. No timers or
 * long polling live in the service worker; settings initiates one bounded poll. */
export class ChatGPTAuthService {
  constructor(private store: InferenceStore, private fetcher: typeof fetch, private hasHostAccess: (origin: string) => Promise<boolean>, private now = () => Date.now()) {}
  async permission() {
    for (const origin of CHATGPT_ORIGINS) if (!await this.hasHostAccess(origin)) throw new ConnectionError('Grant ChatGPT browser access in extension settings first.');
  }
  private async send(url: string, init: RequestInit): Promise<Response> {
    await this.permission();
    try { return await this.fetcher(url, { ...init, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000) }); }
    catch { throw new ConnectionError('ChatGPT could not be reached. Retry in connection settings.'); }
  }
  private async json(response: Response) {
    try { return await boundedJSON(response, 128 * 1024); }
    catch { throw new ConnectionError('ChatGPT returned an invalid or oversized authorization response.'); }
  }
  status(record: InferenceRecord): ChatGPTSignIn {
    const pending = record.chatgpt?.pending;
    if (!pending || pending.expires <= this.now() || pending.exchanging) return null;
    return { verificationUrl: VERIFY_URL, userCode: pending.userCode, expiresAt: pending.expires, pollAfterMs: Math.max(0, pending.nextPoll - this.now()) };
  }
  async start(record: InferenceRecord) {
    const response = await this.send('https://auth.openai.com/api/accounts/deviceauth/usercode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: CLIENT_ID }) });
    if (!response.ok) { await response.body?.cancel(); throw new ConnectionError('ChatGPT device sign-in is unavailable. Check device-code login in ChatGPT security settings or workspace permissions.'); }
    const parsed = deviceSchema.safeParse(await this.json(response));
    if (!parsed.success) throw new ConnectionError('ChatGPT returned an invalid device code.');
    const interval = Math.max(1000, parsed.data.interval * 1000);
    record.chatgpt = { ...record.chatgpt, pending: { deviceId: parsed.data.device_auth_id, userCode: parsed.data.user_code, interval, nextPoll: this.now() + interval, expires: this.now() + 15 * 60000 } };
    await this.store.put(record);
    return this.status(record);
  }
  async poll(record: InferenceRecord) {
    const pending = record.chatgpt?.pending;
    if (!pending) return null;
    if (pending.exchanging || pending.expires <= this.now()) {
      delete record.chatgpt!.pending; await this.store.put(record);
      throw new ConnectionError('ChatGPT sign-in expired or was interrupted. Connect again.');
    }
    if (pending.nextPoll > this.now()) return this.status(record);
    pending.nextPoll = this.now() + pending.interval;
    await this.store.put(record); // Enforce interval across reloads/worker restarts.
    const response = await this.send('https://auth.openai.com/api/accounts/deviceauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device_auth_id: pending.deviceId, user_code: pending.userCode }) });
    const data = await this.json(response);
    if (!response.ok) {
      const failure = z.object({ error: z.union([z.string(), z.object({ code: z.string() })]).optional() }).safeParse(data);
      const error = failure.success ? typeof failure.data.error === 'string' ? failure.data.error : failure.data.error?.code : undefined;
      if (error === 'slow_down') { pending.interval += 5000; pending.nextPoll = this.now() + pending.interval; await this.store.put(record); return this.status(record); }
      if (error === 'access_denied' || error === 'expired_token') {
        delete record.chatgpt!.pending; await this.store.put(record);
        throw new ConnectionError('ChatGPT sign-in was declined or expired. Connect again.');
      }
      if (error === 'deviceauth_authorization_pending' || response.status === 403 || response.status === 404) return this.status(record);
      throw new ConnectionError(`ChatGPT device sign-in returned HTTP ${response.status}. Retry or connect again.`);
    }
    const parsed = z.object({ authorization_code: string, code_verifier: string }).safeParse(data);
    if (!parsed.success) throw new ConnectionError('ChatGPT returned an invalid authorization result.');
    pending.exchanging = true; await this.store.put(record);
    // An uncertain code exchange is not replayed after restart.
    await this.exchange(record, new URLSearchParams({ grant_type: 'authorization_code', client_id: CLIENT_ID, code: parsed.data.authorization_code, code_verifier: parsed.data.code_verifier, redirect_uri: 'https://auth.openai.com/deviceauth/callback' }));
    record.revision = crypto.randomUUID(); await this.store.put(record);
    return null;
  }
  private async exchange(record: InferenceRecord, body: URLSearchParams) {
    const response = await this.send(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 400 || response.status === 401) { record.chatgpt = {}; await this.store.put(record); }
      throw new ConnectionError('ChatGPT authorization failed. Reconnect in extension settings; no other inference account was used.');
    }
    const parsed = tokenSchema.safeParse(await this.json(response));
    if (!parsed.success) throw new ConnectionError('ChatGPT returned invalid credentials. Reconnect in extension settings.');
    let accountId: string;
    try {
      // Routing metadata only, not a locally verified identity or trusted profile.
      const payload = parsed.data.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const claims = JSON.parse(atob(payload));
      accountId = z.string().regex(/^[\w-]{1,200}$/).parse(claims['https://api.openai.com/auth']?.chatgpt_account_id);
    } catch { throw new ConnectionError('ChatGPT credentials lack the required Codex account. Connect again.'); }
    if (body.get('grant_type') === 'refresh_token' && record.chatgpt?.accountId !== accountId) throw new ConnectionError('ChatGPT account changed during refresh. Reconnect explicitly.');
    record.chatgpt = { access: parsed.data.access_token, refresh: parsed.data.refresh_token, expires: this.now() + parsed.data.expires_in * 1000, accountId };
    await this.store.put(record); // Commit replacement credentials before use.
  }
  async credentials(record: InferenceRecord) {
    const auth = record.chatgpt;
    if (!auth?.access || !auth.refresh || !auth.accountId || auth.refreshing) throw new ConnectionError('Reconnect ChatGPT in extension settings.');
    if ((auth.expires ?? 0) <= this.now() + 60000) {
      auth.refreshing = true; await this.store.put(record);
      await this.exchange(record, new URLSearchParams({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: auth.refresh }));
    }
    return { access: record.chatgpt!.access!, accountId: record.chatgpt!.accountId!, refresh: record.chatgpt!.refresh! };
  }
}

/** Frame SSE before redaction so split network chunks cannot leak a secret.
 * Provider error diagnostics are mapped rather than copied into transcripts. */
export function chatgptEventStream(body: ReadableStream<Uint8Array>, secrets: string[]): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder('utf-8', { fatal: true }), encoder = new TextEncoder();
  let buffer = '', bytes = 0;
  const emit = (frame: string, controller: TransformStreamDefaultController<Uint8Array>) => {
    let safe = frame;
    for (const secret of secrets) if (secret) safe = safe.replaceAll(secret, '[redacted]');
    const raw = safe.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (raw && raw !== '[DONE]') {
      let event: { type?: string; response?: { error?: { code?: string } }; error?: { code?: string } };
      try { event = JSON.parse(raw); } catch { throw new ConnectionError('ChatGPT returned an invalid event.'); }
      if (event?.type === 'error' || event?.type === 'response.failed') {
        const code = event.response?.error?.code ?? event.error?.code;
        const message = typeof code === 'string' && /quota|usage_limit|rate_limit/.test(code) ? 'ChatGPT usage limit reached. Check your ChatGPT plan and limits.' : 'ChatGPT inference failed. Check the connection and account in extension settings.';
        safe = `data: ${JSON.stringify({ type: 'response.failed', response: { error: { message } } })}`;
      }
    }
    controller.enqueue(encoder.encode(safe + '\n\n'));
  };
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > 2 * 1024 * 1024) throw new ConnectionError('ChatGPT response exceeds 2 MiB.');
      buffer += decoder.decode(chunk, { stream: true });
      // Normalize CRLF only after a complete frame delimiter is present.
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index).replaceAll('\r\n', '\n');
        buffer = buffer.slice(match.index + match[0].length); emit(frame, controller);
      }
    },
    flush(controller) { buffer += decoder.decode(); if (buffer.trim()) emit(buffer.replaceAll('\r\n', '\n'), controller); },
  }));
}
