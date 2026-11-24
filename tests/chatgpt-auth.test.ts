import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatGPTAuthService, CHATGPT_INFERENCE_URL } from '../src/chatgpt-auth';
import { InferenceConnections, type InferenceRecord, type InferenceStore } from '../src/inference-connections';

const access = `header.${btoa(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'account-private' } }))}.private-token`;
const tokens = { access_token: access, refresh_token: 'refresh-private', expires_in: 3600 };
function fixture(fetcher: typeof fetch, permission = async () => true) {
  const record: InferenceRecord = { id: crypto.randomUUID(), revision: crypto.randomUUID(), name: 'My ChatGPT', url: CHATGPT_INFERENCE_URL, headers: [], model: 'model-a', hostedGrants: [{ origin: 'https://app.example', subpath: '/agent/' }], chatgpt: {} };
  const records = new Map([[record.id, structuredClone(record)]]);
  const store: InferenceStore = { all: async () => structuredClone([...records.values()]), get: async id => structuredClone(records.get(id)), put: async r => { records.set(r.id, structuredClone(r)); }, remove: async id => { records.delete(id); } };
  const auth = new ChatGPTAuthService(store, fetcher, permission);
  const broker = new InferenceConnections(store, fetcher, permission);
  return { record, records, store, auth, broker };
}
afterEach(() => vi.useRealTimers());
const device = () => Response.json({ device_auth_id: 'device-private', user_code: 'ABCD-1234', interval: '5' });
describe('ChatGPT device connection', () => {
  it('persists pending sign-in, resumes after worker restart, respects interval, exchanges once and redacts descriptors', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => device()).mockImplementationOnce(async () => Response.json({ authorization_code: 'code-private', code_verifier: 'verifier-private' })).mockImplementationOnce(async () => Response.json(tokens));
    const { record, store, auth, broker } = fixture(fetcher);
    expect(await auth.start(record)).toMatchObject({ userCode: 'ABCD-1234', verificationUrl: 'https://auth.openai.com/codex/device' });
    const restarted = new ChatGPTAuthService(store, fetcher, async () => true);
    await restarted.poll((await store.get(record.id))!); expect(fetcher).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(await restarted.poll((await store.get(record.id))!)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(new URLSearchParams(fetcher.mock.calls[2][1]!.body as string).get('code_verifier')).toBe('verifier-private');
    expect(fetcher.mock.calls[2][1]).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' });
    const saved = (await store.get(record.id))!;
    expect(saved.chatgpt).toMatchObject({ access, refresh: tokens.refresh_token, accountId: 'account-private' });
    expect(saved.chatgpt!.pending).toBeUndefined(); expect(saved.revision).not.toBe(record.revision);
    for (const result of [await broker.handle({ operation: 'list' }), await broker.handleHosted('https://app.example/agent/', { operation: 'inferenceConnections' })]) {
      expect(JSON.stringify(result)).not.toMatch(/private|ABCD|auth\.openai|backend-api/);
      expect(result).toMatchObject([{ provider: 'chatgpt', protocol: 'openai-codex-responses', authStatus: 'connected' }]);
    }
  });
  it('honors slow_down and explicit denial instead of treating it as pending', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => device()).mockImplementationOnce(async () => Response.json({ error: 'slow_down' }, { status: 429 })).mockImplementationOnce(async () => Response.json({ error: 'access_denied' }, { status: 403 }));
    const { record, auth, store } = fixture(fetcher); await auth.start(record); vi.advanceTimersByTime(5000);
    expect(await auth.poll(record)).toMatchObject({ pollAfterMs: 10000 });
    vi.advanceTimersByTime(10000); await expect(auth.poll(record)).rejects.toThrow('declined');
    expect((await store.get(record.id))!.chatgpt!.pending).toBeUndefined();
  });
  it('never replays an interrupted exchange and expires pending codes', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => device()).mockImplementationOnce(async () => Response.json({ authorization_code: 'code', code_verifier: 'verifier' })).mockRejectedValueOnce(Error('secret provider diagnostics'));
    const { record, auth, store } = fixture(fetcher); await auth.start(record); vi.advanceTimersByTime(5000);
    await expect(auth.poll(record)).rejects.not.toThrow('secret');
    const restarted = new ChatGPTAuthService(store, fetcher, async () => true);
    await expect(restarted.poll((await store.get(record.id))!)).rejects.toThrow('interrupted');
    expect(fetcher).toHaveBeenCalledTimes(3);
    record.chatgpt = { pending: { deviceId: 'x', userCode: 'x', interval: 1000, expires: Date.now() - 1, nextPoll: 0 } };
    await expect(auth.poll(record)).rejects.toThrow('expired'); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('refreshes under the broker mutex once for concurrent opens and commits tokens before use', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => String(url).endsWith('/oauth/token') ? Response.json(tokens) : new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }));
    const { record, store, broker } = fixture(fetcher);
    record.chatgpt = { access: 'expired', refresh: 'old-refresh', accountId: 'account-private', expires: 0 }; await store.put(record);
    const open = () => broker.handleHosted('https://app.example/agent/', { operation: 'inferenceOpen', id: record.id, revision: record.revision, requestId: crypto.randomUUID(), body: JSON.stringify({ input: [{ role: 'user', content: 'Hello' }] }) });
    await Promise.all([open(), open()]);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/oauth/token'))).toHaveLength(1);
    expect((await store.get(record.id))!.chatgpt!.refresh).toBe('refresh-private');
    for (const [url, init] of fetcher.mock.calls.filter(([url]) => String(url).includes('/codex/responses'))) {
      expect(url).toBe(CHATGPT_INFERENCE_URL); expect(new Headers(init!.headers).get('authorization')).toBe(`Bearer ${access}`);
      expect(new Headers(init!.headers).get('chatgpt-account-id')).toBe('account-private');
      expect(JSON.parse(init!.body as string)).toMatchObject({ model: 'model-a', store: false, stream: true });
      expect(JSON.parse(init!.body as string)).not.toHaveProperty('max_tokens');
    }
    broker.cancelActive();
  });
  it('does not reuse an uncertain rotating refresh token after restart', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => { throw Error('private'); });
    const { record, store, auth } = fixture(fetcher); record.chatgpt = { access: 'old', refresh: 'old-refresh', accountId: 'account', expires: 0 }; await store.put(record);
    await expect(auth.credentials(record)).rejects.not.toThrow('private');
    const restarted = new ChatGPTAuthService(store, fetcher, async () => true);
    await expect(restarted.credentials((await store.get(record.id))!)).rejects.toThrow('Reconnect');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('fails closed on credential commit failure and does not send inference with an unpersisted replacement', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(tokens));
    const { record, store, records, broker } = fixture(fetcher);
    record.chatgpt = { access: 'old', refresh: 'old-refresh', expires: 0, accountId: 'account-private' }; await store.put(record);
    const put = store.put;
    store.put = async next => { if (next.chatgpt?.refresh === 'refresh-private') throw Error('storage unavailable'); await put(next); };
    const open = () => broker.handleHosted('https://app.example/agent/', { operation: 'inferenceOpen', id: record.id, revision: record.revision, requestId: crypto.randomUUID(), body: JSON.stringify({ input: [{}] }) });
    await expect(open()).rejects.toThrow();
    expect(records.get(record.id)!.chatgpt!.refreshing).toBe(true);
    await expect(open()).rejects.toThrow('Reconnect'); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('clears unusable tokens on terminal refresh failure without returning provider diagnostics', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ error: 'invalid_grant', error_description: 'private-provider-data' }, { status: 400 }));
    const { record, store, auth } = fixture(fetcher);
    record.chatgpt = { access: 'old', refresh: 'old-refresh', expires: 0, accountId: 'account-private' }; await store.put(record);
    await expect(auth.credentials(record)).rejects.not.toThrow('private-provider-data');
    expect((await store.get(record.id))!.chatgpt).toEqual({});
  });
  it('does not silently change accounts on refresh', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(tokens));
    const { record, store, auth } = fixture(fetcher);
    record.chatgpt = { access: 'old', refresh: 'old-refresh', expires: 0, accountId: 'different-account' }; await store.put(record);
    await expect(auth.credentials(record)).rejects.toThrow('account changed');
    expect((await store.get(record.id))!.chatgpt).toMatchObject({ accountId: 'different-account', refreshing: true, access: 'old' });
  });
  it('prevents late inference after disconnect overtakes refresh; no resurrection or fallback', async () => {
    let ready!: () => void, finish!: (r: Response) => void;
    const started = new Promise<void>(r => { ready = r; });
    const fetcher = vi.fn<typeof fetch>(async () => { ready(); return new Promise(r => { finish = r; }); });
    const { record, store, broker } = fixture(fetcher);
    record.chatgpt = { access: 'old', refresh: 'old-refresh', expires: 0, accountId: 'account-private' }; await store.put(record);
    const opening = broker.handleHosted('https://app.example/agent/', { operation: 'inferenceOpen', id: record.id, revision: record.revision, requestId: crypto.randomUUID(), body: JSON.stringify({ input: [{}] }) });
    await started; const disconnect = broker.handle({ operation: 'chatgptDisconnect', id: record.id }); finish(Response.json(tokens));
    await expect(opening).rejects.toThrow('cancelled'); await disconnect;
    expect((await store.get(record.id))!.chatgpt).toEqual({}); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps authorization settings-only, refuses permissions/injected fields, and disconnect stops streams', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => device());
    const { record, broker } = fixture(fetcher, async () => false);
    await expect(broker.handle({ operation: 'chatgptStart', id: record.id })).rejects.toThrow('browser access');
    await expect(broker.handleHosted('https://app.example/agent/', { operation: 'chatgptPoll', id: record.id })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    const allowed = fixture(fetcher);
    for (const body of [{ input: [{}], url: 'https://evil.example' }, { input: [{}], headers: {} }, { messages: [{}] }]) {
      await expect(allowed.broker.handleHosted('https://app.example/agent/', { operation: 'inferenceOpen', id: allowed.record.id, revision: allowed.record.revision, requestId: crypto.randomUUID(), body: JSON.stringify(body) })).rejects.toThrow('Expected messages');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
