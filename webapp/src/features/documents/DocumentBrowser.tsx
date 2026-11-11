import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AppHooksV1 } from '../../app-hooks/contracts';
import { createHostedAppHooks } from '../../app-hooks/host';
import { createDocumentBrowserController } from './controller';
import type { DocumentBrowserPresentation } from './contracts';
import { DocumentBrowserView } from './DocumentBrowser.view';
import { AppPending } from '../../views/AppPending.view';
import { readTreeAppearance, saveTreeAppearance } from './tree-appearance';

export function DocumentBrowser({
  appHooks,
  presentation: Presentation = DocumentBrowserView,
}: { appHooks?: AppHooksV1; presentation?: DocumentBrowserPresentation }) {
  const [controller, setController] = useState<ReturnType<typeof createDocumentBrowserController> | null>(null);
  useEffect(() => {
    const mounted = createDocumentBrowserController(appHooks ?? createHostedAppHooks(), readTreeAppearance());
    let appearance = mounted.getSnapshot().treeAppearance;
    const unsubscribe = mounted.subscribe(() => {
      const next = mounted.getSnapshot().treeAppearance;
      if (next !== appearance) { appearance = next; saveTreeAppearance(next); }
    });
    setController(mounted);
    mounted.actions.connect();
    return () => { unsubscribe(); mounted.dispose(); };
  }, [appHooks]);
  return controller ? <SubscribedBrowser controller={controller} presentation={Presentation} /> : <AppPending />;
}

function SubscribedBrowser({ controller, presentation: Presentation }: {
  controller: ReturnType<typeof createDocumentBrowserController>;
  presentation: DocumentBrowserPresentation;
}) {
  const model = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
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
        controller.actions.setDocumentFullscreen(false);
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [controller, model.documentFullscreen]);
  return <Presentation model={model} actions={controller.actions} />;
}
