import type { SurfaceProps } from '../../presentation/Presentation';
import type { DocumentBrowserProps } from './contracts';
import { DocumentNavigation } from './DocumentNavigation';
import { DocumentsWorkspace } from './DocumentsWorkspace.view';
import { DocumentsReading } from './DocumentsReading.view';
import { DocumentTree } from './DocumentTree';
import { FeedbackProvider } from '../feedback/FeedbackProvider';
import { copy } from './Documents.copy';
export function DocumentsPhoneView({ model, actions, presentation }: SurfaceProps<DocumentBrowserProps>) {
  const reading = model.documentFullscreen && Boolean(model.documentId);
  return <FeedbackProvider><main className={`app-shell documents-phone${reading ? ' document-fullscreen' : ''}`} data-surface="phone" data-orientation={presentation.orientation}>
    <DocumentNavigation model={model} actions={actions} />
    {!reading && !model.snapshot && <DocumentsWorkspace model={model} actions={actions} />}
    <p role="status">{model.status}</p>{model.error && <p role="alert">{model.error}</p>}
    {reading ? <DocumentsReading model={model} actions={actions} /> : model.snapshot && <section aria-label={copy.title}>
      <label>{copy.find}<input type="search" value={model.query} onChange={e => actions.setQuery(e.target.value)} /></label>
      <DocumentTree model={model} actions={actions} />
    </section>}
  </main></FeedbackProvider>;
}
