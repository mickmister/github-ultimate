import type { AppHooksV1 } from '../../app-hooks/contracts';
import type { DocumentBrowserPresentation } from './contracts';
import type { DocumentNavigation } from './navigation';
import type { createDocumentBrowserController } from './controller';
import { AppPending } from '../../views/AppPending.view';
import { DocumentBrowserView } from './DocumentBrowser.view';
import { useDocumentController, useDocumentsFeature } from './Documents.hooks';
import { FeedbackProvider } from '../feedback/FeedbackProvider';

export function DocumentBrowser({ appHooks, presentation = DocumentBrowserView, navigation }: {
  appHooks?: AppHooksV1; presentation?: DocumentBrowserPresentation; navigation?: DocumentNavigation;
}) {
  const controller = useDocumentController(appHooks, navigation);
  return <FeedbackProvider>{controller ? <SubscribedBrowser controller={controller} presentation={presentation} navigation={navigation} /> : <AppPending />}</FeedbackProvider>;
}
function SubscribedBrowser({ controller, presentation: Presentation, navigation }: {
  controller: ReturnType<typeof createDocumentBrowserController>; presentation: DocumentBrowserPresentation; navigation?: DocumentNavigation;
}) {
  const props = useDocumentsFeature(controller, navigation);
  return <Presentation {...props} />;
}
