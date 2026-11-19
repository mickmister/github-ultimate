import { useEffect, useState } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { BrowserAgent, type AgentFields } from '../../../../hosted/browser-agent';
import type { AgentProps } from './Agent.view';
export function useAgentLocation() { return useRouterState({ select: state => state.location.search as Record<string, unknown> }); }
export function useAgentFeature(location: Record<string, unknown> = {}, injected?: BrowserAgent): AgentProps {
  const [model] = useState(() => { const service = injected ?? new BrowserAgent(); service.fields.github = typeof location.connection === 'string' ? location.connection : ''; service.fields.repository = typeof location.repository === 'string' ? location.repository : ''; return service; });
  const [, refresh] = useState(0);
  useEffect(() => {
    const unsubscribe = model.subscribe(() => refresh(value => value + 1));
    const preventLoss = (event: BeforeUnloadEvent) => { if (model.busy || model.dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', preventLoss);
    return () => { unsubscribe(); window.removeEventListener('beforeunload', preventLoss); model.dispose(); };
  }, [model]);
  const invoke = (work: () => Promise<void>) => { void model.run(work); };
  const query = new URLSearchParams(Object.entries(location).filter((entry): entry is [string, string] => ['connection', 'repository', 'workspace'].includes(entry[0]) && typeof entry[1] === 'string')).toString();
  return { model, documentsHref: `#/documents?${query}`, actions: {
    edit: (key: keyof AgentFields, value: string) => model.edit(key, value), connect: () => invoke(() => model.connect()), create: (imported: boolean) => invoke(() => model.create(imported)), list: (more: boolean) => invoke(() => model.list(more)), restore: () => invoke(() => model.restore()), save: () => invoke(() => model.save()), prompt: () => invoke(() => model.prompt()), script: () => invoke(() => model.script()), commit: () => invoke(() => model.commit()), stop: () => model.stop(),
  } };
}
