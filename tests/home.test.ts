import { describe, expect, it, vi } from 'vitest';
import { createHomeController } from '../webapp/src/features/home/Home.controller';
import { createReviewFixture } from '../webapp/stories/reviews.fixtures';
import { reviewHref } from '../webapp/src/features/reviews/navigation';
import type { ConnectionDTO, DocumentsModuleV1 } from '../webapp/src/app-hooks/contracts';

const connections: ConnectionDTO[] = [
  { id: 'a', installationId: 1, name: 'A', account: 'a' },
  { id: 'b', installationId: 2, name: 'B', account: 'b' },
];
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture() {
  const base = createReviewFixture();
  const documents: { -readonly [K in keyof DocumentsModuleV1]: DocumentsModuleV1[K] } = { ...base.modules.documents };
  const hooks = { ...base, modules: { documents, reviews: { ...base.modules.reviews! } } };
  hooks.modules.documents.connect = vi.fn(async () => connections);
  hooks.modules.documents.repositories = vi.fn(async () => [{ fullName: 'org/repo', private: true }]);
  hooks.modules.documents.discover = vi.fn(async () => [{ id: 'alpha', hasDocuments: true }, { id: 'beta', hasDocuments: true }, { id: 'empty', hasDocuments: false }]);
  hooks.modules.documents.dispose = vi.fn();
  hooks.modules.documents.open = vi.fn();
  hooks.modules.documents.read = vi.fn();
  hooks.modules.reviews!.read = vi.fn();
  hooks.modules.reviews!.open = vi.fn();
  return hooks;
}
describe('Reviews Home sources', () => {
  it('aggregates approved connections and document workspaces without opening bodies; links exact scope and pins', async () => {
    const hooks = fixture(), controller = createHomeController(hooks);
    await controller.actions.connect(); await flush();
    const sources = controller.getSnapshot().sources.filter(source => source.listing);
    expect(sources).toHaveLength(4);
    expect(new Set(sources.map(source => `${source.scope!.connectionId}/${source.scope!.workspace}`)).size).toBe(4);
    for (const source of sources) {
      const review = source.listing!.requests[0];
      const link = new URL(reviewHref(source.scope!, review).slice(1), 'https://example.test');
      expect(link.pathname).toBe(`/reviews/${review.request.request_id}`);
      expect(Object.fromEntries(link.searchParams)).toEqual({ connection: source.scope!.connectionId, repository: 'org/repo', workspace: source.scope!.workspace, version: review.pin.version, snapshot: review.pin.snapshot });
    }
    expect(hooks.modules.documents.open).not.toHaveBeenCalled(); expect(hooks.modules.documents.read).not.toHaveBeenCalled();
    expect(hooks.modules.reviews!.open).not.toHaveBeenCalled(); expect(hooks.modules.reviews!.read).not.toHaveBeenCalled();
    controller.dispose(); expect(hooks.modules.documents.dispose).toHaveBeenCalledOnce();
  });
  it('retains healthy workspaces and retries only the failed listing', async () => {
    const hooks = fixture(), list = hooks.modules.reviews!.list;
    let fail = true;
    const calls: string[] = [];
    hooks.modules.reviews!.list = async scope => { calls.push(`${scope.connectionId}/${scope.workspace}`); if (fail && scope.connectionId === 'b' && scope.workspace === 'beta') throw Error('Access denied'); return list(scope); };
    const controller = createHomeController(hooks);
    await controller.actions.connect(); await flush();
    expect(controller.getSnapshot().sources.filter(source => source.listing)).toHaveLength(3);
    const failed = controller.getSnapshot().sources.find(source => source.error)!;
    expect(failed.scope).toMatchObject({ connectionId: 'b', workspace: 'beta' });
    fail = false; controller.actions.retry(failed.id); await flush();
    expect(calls).toEqual(['a/alpha', 'a/beta', 'b/alpha', 'b/beta', 'b/beta']);
    expect(controller.getSnapshot().sources.filter(source => source.listing)).toHaveLength(4);
    controller.dispose();
  });
  it('uses explicit repository discovery only under an approved connection when enumeration is absent', async () => {
    const hooks = fixture(); hooks.modules.documents.repositories = undefined;
    const controller = createHomeController(hooks);
    await controller.actions.connect(); await flush();
    expect(hooks.modules.documents.discover).not.toHaveBeenCalled();
    controller.actions.addRepository('unapproved', 'org/repo');
    controller.actions.addRepository('a', 'invalid');
    expect(hooks.modules.documents.discover).not.toHaveBeenCalled();
    controller.actions.addRepository('b', ' org/repo '); await flush();
    expect(hooks.modules.documents.discover).toHaveBeenCalledExactlyOnceWith({ connectionId: 'b', installationId: 2, repository: 'org/repo' });
    controller.actions.addRepository('b', 'ORG/REPO'); await flush();
    expect(hooks.modules.documents.discover).toHaveBeenCalledOnce(); controller.dispose();
  });
  it('drops in-flight discovery after reconnect revokes a connection and after disposal', async () => {
    const hooks = fixture();
    let finish!: (value: readonly { fullName: string; private: boolean }[]) => void;
    hooks.modules.documents.repositories = () => new Promise(resolve => { finish = resolve; });
    const controller = createHomeController(hooks);
    await controller.actions.connect();
    hooks.modules.documents.connect = async () => [];
    await controller.actions.connect(); finish([{ fullName: 'org/revoked', private: true }]); await flush();
    expect(controller.getSnapshot().connections).toEqual([]); expect(controller.getSnapshot().sources).toEqual([]);
    expect(hooks.modules.documents.discover).not.toHaveBeenCalled();
    const listener = vi.fn(); controller.subscribe(listener); controller.dispose();
    await controller.actions.connect(); expect(listener).not.toHaveBeenCalled();
  });
  it('shows connection enumeration and workspace discovery failures independently and retries their subtree', async () => {
    const hooks = fixture(); let failRepositories = true, failDiscover = true;
    hooks.modules.documents.repositories = async id => { if (id === 'b' && failRepositories) throw Error('Repository access changed'); return [{ fullName: 'org/repo', private: true }]; };
    hooks.modules.documents.discover = async scope => { if (scope.connectionId === 'a' && failDiscover) throw Error('Workspace unavailable'); return [{ id: 'alpha', hasDocuments: true }]; };
    const controller = createHomeController(hooks); await controller.actions.connect(); await flush();
    expect(controller.getSnapshot().sources.filter(source => source.error).map(source => source.kind).sort()).toEqual(['connection', 'repository']);
    failRepositories = false; failDiscover = false;
    for (const source of controller.getSnapshot().sources.filter(source => source.error)) controller.actions.retry(source.id);
    await flush(); expect(controller.getSnapshot().sources.filter(source => source.listing)).toHaveLength(2);
    expect(controller.getSnapshot().sources.some(source => source.error)).toBe(false); controller.dispose();
  });
  it('ignores a late listing after disposal and does not notify a removed subscriber', async () => {
    const hooks = fixture();
    const listing = await hooks.modules.reviews.list({ connectionId: 'a', installationId: 1, repository: 'org/repo', workspace: 'alpha' });
    const pending: Array<(value: typeof listing) => void> = [];
    hooks.modules.reviews.list = () => new Promise(resolve => pending.push(resolve));
    const controller = createHomeController(hooks), listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    await controller.actions.connect(); await flush();
    expect(pending).toHaveLength(4);
    unsubscribe(); listener.mockClear();
    const state = controller.getSnapshot(); controller.dispose();
    for (const resolve of pending) resolve(listing);
    await flush(); expect(controller.getSnapshot()).toBe(state); expect(listener).not.toHaveBeenCalled();
  });
  it('does not discover sources when the review module is unavailable and recovers a failed connection load', async () => {
    const base = fixture(); let fail = true;
    base.modules.documents.connect = async () => { if (fail) throw Error('Broker unavailable'); return connections; };
    const controller = createHomeController({ ...base, modules: { documents: base.modules.documents } });
    await controller.actions.connect(); expect(controller.getSnapshot().error).toBe('Broker unavailable');
    fail = false; await controller.actions.connect(); expect(controller.getSnapshot()).toMatchObject({ error: '', supported: false, connections, sources: [] });
    expect(base.modules.documents.repositories).not.toHaveBeenCalled(); controller.dispose();
  });
});
