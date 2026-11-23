import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AppHooksV1 } from '../../app-hooks/contracts';
import { createHostedAppHooks } from '../../app-hooks/host';
import { createHomeController } from './Home.controller';
import type { HomeModel } from './Home.model';
import { applicationStorage } from '../../app-storage';
import { homeCopy } from './Home.copy';

const dismissalPrefix = 'github-ultimate:review-dismissed:v1:';

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
  const [waitingOnly, setWaitingOnly] = useState(true);
  const [showDismissed, setShowDismissed] = useState(false);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [preferencesReady, setPreferencesReady] = useState(false), [preferencesError, setPreferencesError] = useState('');
  const storage = useRef<Awaited<ReturnType<typeof applicationStorage>> | undefined>(undefined);
  const write = useRef(0);
  useEffect(() => {
    let stopped = false;
    void applicationStorage().then(opened => {
      if (stopped) return;
      storage.current = opened;
      const keys = new Set<string>();
      for (let i = 0; i < opened.length; i++) {
        const key = opened.key(i);
        if (key?.startsWith(dismissalPrefix) && opened.getItem(key) === '1') keys.add(key.slice(dismissalPrefix.length));
      }
      setDismissed(keys); setPreferencesReady(true);
    }).catch(() => { if (!stopped) { setPreferencesError(homeCopy.preferenceError.text); setPreferencesReady(true); } });
    return () => { stopped = true; };
  }, []);
  const state = useSyncExternalStore(controller?.subscribe ?? emptySubscribe, controller?.getSnapshot ?? emptySnapshot, emptySnapshot);
  return {
    state, connectionId, repository, waitingOnly, showDismissed, dismissed, preferencesReady, preferencesError,
    actions: {
      setConnectionId, setRepository, setWaitingOnly, setShowDismissed,
      dismiss(key, value) {
        setDismissed(current => { const next = new Set(current); if (value) next.add(key); else next.delete(key); return next; });
        const revision = ++write.current;
        try {
          const opened = storage.current;
          if (!opened) { setPreferencesError(homeCopy.preferenceError.text); return; }
          if (value) opened.setItem(dismissalPrefix + key, '1'); else opened.removeItem(dismissalPrefix + key);
          void opened.flush().then(() => { if (write.current === revision) setPreferencesError(''); }, () => setPreferencesError(homeCopy.preferenceError.text));
        } catch { setPreferencesError(homeCopy.preferenceError.text); }
      },
      reconnect: () => controller?.actions.connect(),
      retry: (id: string) => controller?.actions.retry(id),
      addRepository: () => controller?.actions.addRepository(connectionId || state.connections[0]?.id, repository),
    },
  };
}
const emptySubscribe = () => () => {};
const initial = { busy: true, error: '', connections: [], sources: [], canEnumerate: true, supported: true };
const emptySnapshot = () => initial;
