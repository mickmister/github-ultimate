import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AppHooksV1 } from '../../app-hooks/contracts';
import { createHostedAppHooks } from '../../app-hooks/host';
import { createHomeController } from './Home.controller';
import type { HomeModel } from './Home.model';
import type { ReviewQueueFilter } from '../reviews/queue';

function useHomeSession(appHooks?: AppHooksV1) {
  const [controller, setController] = useState<ReturnType<typeof createHomeController> | null>(null);
  useEffect(() => {
    const next = createHomeController(appHooks ?? createHostedAppHooks());
    setController(next);
    void next.actions.connect();
    return () => next.dispose();
  }, [appHooks]);
  return controller;
}
export function useHomeFeature(appHooks?: AppHooksV1): HomeModel {
  const controller = useHomeSession(appHooks);
  const [connectionId, setConnectionId] = useState('');
  const [repository, setRepository] = useState('');
  const [queueFilter, setQueueFilter] = useState<ReviewQueueFilter>('active');
  const state = useSyncExternalStore(controller?.subscribe ?? emptySubscribe, controller?.getSnapshot ?? emptySnapshot, emptySnapshot);
  return {
    state, connectionId, repository, queueFilter,
    actions: {
      setConnectionId, setRepository, setQueueFilter,
      categorize: (sourceId, requestId, category) => { void controller?.actions.categorize(sourceId, requestId, category); },
      reconnect: () => controller?.actions.connect(),
      retry: (id: string) => controller?.actions.retry(id),
      addRepository: () => controller?.actions.addRepository(connectionId || state.connections[0]?.id, repository),
    },
  };
}
const emptySubscribe = () => () => {};
const initial = { busy: true, error: '', connections: [], sources: [], canEnumerate: true, supported: true, categorizing: [], categoryError: '' };
const emptySnapshot = () => initial;
