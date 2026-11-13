import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AppHooksV1 } from '../../app-hooks/contracts';
import { createHostedAppHooks } from '../../app-hooks/host';
import { createDocumentBrowserController } from './controller';
import type { DocumentBrowserPresentation } from './contracts';
import { DocumentBrowserView } from './DocumentBrowser.view';
import { AppPending } from '../../views/AppPending.view';
import { readTreeAppearance, saveTreeAppearance } from './tree-appearance';
import type { DocumentNavigation } from './navigation';

export function DocumentBrowser({
  appHooks,
  presentation: Presentation = DocumentBrowserView,
  navigation,
}: { appHooks?: AppHooksV1; presentation?: DocumentBrowserPresentation; navigation?: DocumentNavigation }) {
  const [controller, setController] = useState<ReturnType<typeof createDocumentBrowserController> | null>(null);
  useEffect(() => {
    let stopped = false, dispose = () => {};
    void readTreeAppearance().then(initial => {
      if (stopped) return;
      const mounted = createDocumentBrowserController(appHooks ?? createHostedAppHooks(), initial);
      let appearance = mounted.getSnapshot().treeAppearance;
      const unsubscribe = mounted.subscribe(() => {
        const next = mounted.getSnapshot().treeAppearance;
        if (next !== appearance) { appearance = next; void saveTreeAppearance(next); }
      });
      dispose = () => { unsubscribe(); mounted.dispose(); };
      setController(mounted);
      if (!navigation) mounted.actions.connect();
    });
    return () => { stopped = true; dispose(); };
  }, [appHooks]);
  return controller ? <SubscribedBrowser controller={controller} presentation={Presentation} navigation={navigation} /> : <AppPending />;
}

function SubscribedBrowser({ controller, presentation: Presentation, navigation }: {
  controller: ReturnType<typeof createDocumentBrowserController>;
  presentation: DocumentBrowserPresentation;
  navigation?: DocumentNavigation;
}) {
  const model = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'hidden') controller.actions.refresh?.(); };
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh);
    const timer = setInterval(refresh, 60000);
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); clearInterval(timer); };
  }, [controller]);
  useEffect(() => { if (navigation) controller.actions.openLocation(navigation.location); }, [controller, navigation?.location]);
  const scope = { connection: model.connections.length === 1 ? undefined : model.connectionId, repository: model.repository.trim(), workspace: model.workspaceId };
  const actions = navigation ? {
    ...controller.actions,
    browseDocuments() {
      if (!model.canBrowse) return;
      const current = navigation.location;
      if (!current.documentId && current.connection === scope.connection && current.repository === scope.repository && current.workspace === scope.workspace) controller.actions.browseDocuments();
      else navigation.navigate(scope);
    },
    selectDocument(documentId: string) {
      if (documentId === model.documentId && model.documentFullscreen) controller.actions.selectDocument(documentId);
      else navigation.navigate({ ...scope, documentId });
    },
    setDocumentFullscreen(fullscreen: boolean) { navigation.navigate({ ...scope, documentId: fullscreen ? model.documentId : undefined }); },
  } : controller.actions;
  const wasFullscreen = useRef(false);
  useEffect(() => {
    if (wasFullscreen.current && !model.documentFullscreen) {
      document.querySelector<HTMLElement>('.document-tree [data-selected]')?.focus();
    }
    wasFullscreen.current = model.documentFullscreen;
  }, [model.documentFullscreen]);
  useEffect(() => {
    if (!model.documentFullscreen) return;
    const escape = (event: KeyboardEvent) => {
      // Monaco owns Escape for its find widget and other editor interactions.
      if (event.key === 'Escape' && !event.defaultPrevented && !(event.target instanceof Element && event.target.closest('.monaco-editor, [data-feedback-control], [data-scope="menu"], [data-scope="dialog"]'))) {
        actions.setDocumentFullscreen(false);
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [actions, model.documentFullscreen]);
  return <Presentation model={model} actions={actions} />;
}
