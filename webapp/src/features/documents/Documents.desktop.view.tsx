import type { SurfaceProps } from '../../presentation/Presentation';
import type { DocumentBrowserProps } from './contracts';
import { DocumentNavigation } from './DocumentNavigation';
import { DocumentsWorkspace } from './DocumentsWorkspace.view';
import { DocumentsReading } from './DocumentsReading.view';
import { DocumentTree } from './DocumentTree';
import { DocumentTreeAppearance } from './DocumentTreeAppearance.view';
import { FeedbackProvider } from '../feedback/FeedbackProvider';
import { copy } from './Documents.copy';
import { LoadingIndicator } from '../../views/LoadingIndicator.view';
export function DocumentsDesktopView({ model, actions, presentation }: SurfaceProps<DocumentBrowserProps>) {
  const reading = model.documentFullscreen && Boolean(model.snapshot?.documents.some(d => d.id === model.documentId));
  return <FeedbackProvider><main className={`app-shell documents-desktop${reading ? ' document-fullscreen' : ''}`} data-surface="desktop" data-orientation={presentation.orientation}>
    <DocumentNavigation model={model} actions={actions} />
    {!reading && <DocumentsWorkspace model={model} actions={actions} />}
    {model.busy ? !(model.documentId && model.content === null && model.snapshot) && <LoadingIndicator compact={Boolean(model.snapshot)} label={model.status} /> : <p className="request-status" role="status">{model.status}</p>}{model.error && <p role="alert">{model.error}</p>}
    {model.snapshot && <section className="browser">
      {!reading && <aside className="document-sidebar"><h2>{copy.title}</h2><label>{copy.find}<input type="search" value={model.query} onChange={e => actions.setQuery(e.target.value)} /></label>
        <DocumentTreeAppearance model={model} actions={actions} /><DocumentTree model={model} actions={actions} /></aside>}
      <DocumentsReading model={model} actions={actions} />
    </section>}
  </main></FeedbackProvider>;
}
