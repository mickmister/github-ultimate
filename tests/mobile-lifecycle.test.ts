import { afterEach, expect, it, vi } from 'vitest';
import { MobileLifecycle } from '../src/mobile-lifecycle';
import { grantForEntry, MobileFixtureBroker } from '../src/mobile-protocol';
import { AsyncPageKVStore } from '../src/page-kv';

const document = { documentId: 'kept-document', documentURL: 'https://example.test/isolation/index.html', state: 'ready' as const };
const context = { ...document, isMainFrame: true };
const raw = (method: string, params: object) => JSON.stringify({ jsonrpc: '2.0', id: 'request', method, params });
afterEach(() => vi.useRealTimers());

it('reactivates the same native document after transient focus loss without requesting a new page', () => {
  const broker = new MobileFixtureBroker(), lifecycle = new MobileLifecycle(broker, true);
  broker.approve(grantForEntry(document.documentURL)); lifecycle.documentChanged(document);
  const echo = () => broker.handle(context, raw('fixture.echo', { text: 'control' }));
  expect(echo().result).toEqual({ text: 'control' });
  expect(lifecycle.stateChanged('inactive')).toBeUndefined();
  expect(echo().error).toBeDefined();
  expect(lifecycle.stateChanged('background')).toBeUndefined();
  expect(lifecycle.stateChanged('active')).toEqual(document);
  expect(echo().result).toEqual({ text: 'control' });
  expect(lifecycle.stateChanged('active')).toBeUndefined();
});

it('activates only the latest native-ready document when a load completes in the background', () => {
  const broker = new MobileFixtureBroker(), lifecycle = new MobileLifecycle(broker, true);
  broker.approve(grantForEntry(document.documentURL)); lifecycle.documentChanged(document);
  lifecycle.stateChanged('background');
  const replacement = { ...document, documentId: 'replacement' };
  expect(lifecycle.documentChanged(replacement)).toBeUndefined();
  expect(lifecycle.stateChanged('active')).toEqual(replacement);
  expect(broker.handle(context, raw('fixture.echo', { text: 'old' })).error).toBeDefined();
  expect(broker.handle({ ...replacement, isMainFrame: true }, raw('fixture.echo', { text: 'new' })).result).toEqual({ text: 'new' });
});

it.each(['loading', 'error', 'reset'] as const)('does not revive the previous ready document after %s', state => {
  const lifecycle = new MobileLifecycle(new MobileFixtureBroker(), true);
  lifecycle.documentChanged(document); lifecycle.stateChanged('background');
  if (state === 'reset') lifecycle.reset(); else lifecycle.documentChanged({ ...document, state });
  expect(lifecycle.stateChanged('active')).toBeUndefined();
});

it('rejects a pending fixture even after the exact same document resumes, then allows fresh work', async () => {
  vi.useFakeTimers();
  const broker = new MobileFixtureBroker(), lifecycle = new MobileLifecycle(broker, true);
  broker.approve(grantForEntry(document.documentURL)); lifecycle.documentChanged(document);
  const pending = broker.handleAsync(context, raw('fixture.delay', { text: 'stale', delayMs: 100 }));
  lifecycle.stateChanged('inactive'); lifecycle.stateChanged('active');
  await vi.advanceTimersByTimeAsync(100);
  expect(await pending).toMatchObject({ error: { message: 'Fixture access or document changed during the delay.' } });
  expect(broker.handle(context, raw('fixture.echo', { text: 'fresh' })).result).toEqual({ text: 'fresh' });
});

it('never revives queued storage work or persists stale mutations when the same document resumes', async () => {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const writes: string[] = [];
  const store = new AsyncPageKVStore({
    async getItem() { entered(); await gate; return null; },
    async setItem(_key, value) { writes.push(value); },
  });
  const broker = new MobileFixtureBroker(store), lifecycle = new MobileLifecycle(broker, true);
  broker.approveStorage(grantForEntry(document.documentURL)); lifecycle.documentChanged(document);
  const stale = broker.handleAsync(context, raw('kv.set', { key: 'key', value: 'stale' }));
  await started;
  const queued = broker.handleAsync(context, raw('kv.snapshot', {}));
  lifecycle.stateChanged('background'); lifecycle.stateChanged('active'); release();
  expect((await stale).error).toBeDefined(); expect((await queued).error).toBeDefined();
  expect(writes).toEqual([]);
  expect((await broker.handleAsync(context, raw('kv.set', { key: 'key', value: 'fresh' }))).error).toBeUndefined();
  expect(writes).toHaveLength(1); expect(writes[0]).toContain('fresh');
});
