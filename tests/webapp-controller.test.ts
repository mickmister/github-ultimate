import { describe, expect, it, vi } from 'vitest';
import type { AppHooksV1, DocumentSnapshotDTO } from '../webapp/src/app-hooks/contracts';
import { createDocumentBrowserController } from '../webapp/src/features/documents/controller';

const connection = { id: 'connection-a', name: 'Personal App', account: 'owner', installationId: 123 };
const snapshot: DocumentSnapshotDTO = { id: 'snapshot-a', commit: 'a'.repeat(40), purpose: 'Research', documents: [{ id: 'note-a', path: 'notes/a.md', size: 5 }] };
function setup() {
  const module = {
    version: 1 as const,
    connect: vi.fn(async () => [connection]),
    discover: vi.fn(async () => [{ id: 'workspace-a', hasDocuments: true }, { id: 'dolt-only', hasDocuments: false }]),
    open: vi.fn(async () => snapshot),
    read: vi.fn(async () => 'Hello'),
    dispose: vi.fn(),
  };
  const host: AppHooksV1 = { contractVersion: 1, modules: { documents: module } };
  const controller = createDocumentBrowserController(host);
  controller.actions.setRepository('example/workspace-storage');
  return { module, ...controller };
}
async function ready(controller: ReturnType<typeof setup>, expected = snapshot) {
  controller.actions.connect();
  await vi.waitFor(() => expect(controller.getSnapshot().canDiscover).toBe(true));
  controller.actions.discoverWorkspaces();
  await vi.waitFor(() => expect(controller.getSnapshot().workspaces).toHaveLength(2));
  controller.actions.selectWorkspace('workspace-a');
  controller.actions.browseDocuments();
  await vi.waitFor(() => expect(controller.getSnapshot().snapshot).toEqual(expected));
}

describe('document browser behavior independent of presentation', () => {
  it('switches Markdown/source without another read and resets the mode for non-Markdown or a new scope', async () => {
    const controller = setup();
    const value = { ...snapshot, documents: [...snapshot.documents, { id: 'config', path: 'config.json', size: 2 }] };
    controller.module.open.mockResolvedValueOnce(value);
    await ready(controller, value);
    controller.actions.selectDocument('note-a');
    await vi.waitFor(() => expect(controller.getSnapshot().content).toBe('Hello'));
    controller.actions.setDocumentMode('markdown');
    expect(controller.getSnapshot()).toMatchObject({ documentMode: 'markdown', content: 'Hello' });
    expect(controller.module.read).toHaveBeenCalledTimes(1);
    controller.actions.selectDocument('config');
    await vi.waitFor(() => expect(controller.getSnapshot().busy).toBe(false));
    controller.actions.setDocumentMode('markdown');
    expect(controller.getSnapshot().documentMode).toBe('source');
    controller.actions.setRepository('other/storage');
    expect(controller.getSnapshot()).toMatchObject({ documentMode: 'source', snapshot: null, content: null });
  });

  it('guards commands, binds the selected installation, and rejects missing-document workspaces', async () => {
    const controller = setup();
    controller.actions.discoverWorkspaces(); controller.actions.browseDocuments();
    expect(controller.module.discover).not.toHaveBeenCalled(); expect(controller.module.open).not.toHaveBeenCalled();
    await ready(controller);
    expect(controller.module.open).toHaveBeenCalledWith({ connectionId: 'connection-a', installationId: 123, repository: 'example/workspace-storage', workspace: 'workspace-a' });
    controller.actions.selectWorkspace('dolt-only');
    controller.actions.browseDocuments();
    expect(controller.getSnapshot().canBrowse).toBe(false);
    expect(controller.module.open).toHaveBeenCalledTimes(1);
    controller.actions.setRepository('../invalid');
    expect(controller.getSnapshot().canDiscover).toBe(false);
  });

  it('ignores a discovery response after a repository change', async () => {
    const controller = setup();
    controller.actions.connect();
    await vi.waitFor(() => expect(controller.getSnapshot().canDiscover).toBe(true));
    let finish!: (value: { id: string; hasDocuments: boolean }[]) => void;
    controller.module.discover.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    controller.actions.discoverWorkspaces();
    controller.actions.setRepository('other/storage');
    finish([{ id: 'wrong-repository', hasDocuments: true }]);
    await Promise.resolve(); await Promise.resolve();
    expect(controller.getSnapshot()).toMatchObject({ repository: 'other/storage', workspaces: [], busy: false });
  });

  it('keeps only the latest document read and clears content on a failed retry', async () => {
    const controller = setup();
    controller.module.open.mockResolvedValueOnce({ ...snapshot, documents: [...snapshot.documents, { id: 'note-b', path: 'b.md', size: 5 }] });
    controller.actions.connect();
    await vi.waitFor(() => expect(controller.getSnapshot().canDiscover).toBe(true));
    controller.actions.discoverWorkspaces();
    await vi.waitFor(() => expect(controller.getSnapshot().workspaces).toHaveLength(2));
    controller.actions.selectWorkspace('workspace-a'); controller.actions.browseDocuments();
    await vi.waitFor(() => expect(controller.getSnapshot().snapshot).not.toBeNull());
    let finish!: (value: string) => void;
    controller.module.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    controller.actions.selectDocument('note-a');
    controller.actions.selectDocument('note-b');
    await vi.waitFor(() => expect(controller.getSnapshot().content).toBe('Hello'));
    finish('Stale contents');
    await Promise.resolve(); await Promise.resolve();
    expect(controller.getSnapshot()).toMatchObject({ documentId: 'note-b', content: 'Hello' });
    controller.module.read.mockRejectedValueOnce(new Error('Origin approval revoked'));
    controller.actions.selectDocument('note-b');
    await vi.waitFor(() => expect(controller.getSnapshot().error).toBe('Origin approval revoked'));
    expect(controller.getSnapshot().content).toBeNull();
  });

  it('stops updates when disposed while a request is pending', async () => {
    const controller = setup();
    let finish!: (value: typeof connection[]) => void;
    controller.module.connect.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const listener = vi.fn(); controller.subscribe(listener);
    controller.actions.connect();
    const before = controller.getSnapshot(); controller.dispose();
    listener.mockClear(); finish([connection]);
    await Promise.resolve(); await Promise.resolve();
    expect(controller.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled(); expect(controller.module.dispose).toHaveBeenCalledOnce();
  });
});
