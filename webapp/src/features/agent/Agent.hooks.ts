import { useEffect, useState } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { BrowserAgent, type AgentFields } from '../../../../hosted/browser-agent';
import type { AgentProps } from './Agent.view';
import { RemoteSessions } from '../../../../hosted/live-session';
export function useAgentLocation() { return useRouterState({ select: state => state.location.search as Record<string, unknown> }); }
export function useAgentFeature(location: Record<string, unknown> = {}, injected?: BrowserAgent): AgentProps {
  const [model] = useState(() => { const context = typeof location.repository === 'string' && typeof location.workspace === 'string' ? { repository: location.repository, workspace: location.workspace } : undefined; const service = injected ?? new BrowserAgent(undefined, context); service.fields.github = typeof location.connection === 'string' ? location.connection : ''; service.fields.repository = typeof location.repository === 'string' ? location.repository : ''; return service; });
  const [remote] = useState(() => { const service = new RemoteSessions(model.workspace); if (typeof location.liveRoot === 'string') service.root = location.liveRoot; if (typeof location.live === 'string') service.selected = location.live; return service; });
  const [, refresh] = useState(0);
  useEffect(() => {
    const unsubscribe = model.subscribe(() => refresh(value => value + 1));
    const unsubscribeRemote = remote.subscribe(() => refresh(value => value + 1));
    const preventLoss = (event: BeforeUnloadEvent) => { if (model.busy || model.dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', preventLoss);
    return () => { unsubscribe(); unsubscribeRemote(); window.removeEventListener('beforeunload', preventLoss); model.dispose(); remote.dispose(); };
  }, [model, remote]);
  useEffect(() => {
    if (typeof location.liveRoot === 'string' && location.liveRoot !== remote.root) remote.edit('root', location.liveRoot);
    if (typeof location.live === 'string' && location.live !== remote.selected) remote.edit('selected', location.live);
  }, [remote, location.liveRoot, location.live]);
  const invoke = (work: () => Promise<void>) => { void model.run(work); };
  const query = new URLSearchParams(Object.entries(location).filter((entry): entry is [string, string] => ['connection', 'repository', 'workspace'].includes(entry[0]) && typeof entry[1] === 'string')).toString();
  const liveQuery = new URLSearchParams(query); liveQuery.set('liveRoot', remote.root); liveQuery.set('live', remote.selected);
  return { model, documentsHref: `#/documents?${query}`, remote: { model: remote, href: `#/agent?${liveQuery}`, actions: {
    edit: (key, value) => remote.edit(key, value), connect: () => { void remote.run(() => remote.connect()); }, discover: () => { void remote.run(() => remote.discover()); }, follow: () => { void remote.run(() => remote.follow()); }, pause: () => remote.stop(),
  } }, actions: {
    edit: (key: keyof AgentFields, value: string) => model.edit(key, value), connect: () => invoke(() => model.connect()), create: (imported: boolean) => invoke(() => model.create(imported)), list: (more: boolean) => invoke(() => model.list(more)), restore: () => invoke(() => model.restore()), save: () => invoke(() => model.save()), prompt: () => invoke(() => model.prompt()), script: () => invoke(() => model.script()), commit: () => invoke(() => model.commit()), diff: () => invoke(() => model.diff()), stop: () => model.stop(),
  } };
}
