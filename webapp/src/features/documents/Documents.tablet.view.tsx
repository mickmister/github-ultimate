import type { SurfaceProps } from '../../presentation/Presentation';
import type { DocumentBrowserProps } from './contracts';
import { DocumentNavigation } from './DocumentNavigation';
import { DocumentsWorkspace } from './DocumentsWorkspace.view';
import { DocumentsReading } from './DocumentsReading.view';
import { DocumentTree } from './DocumentTree';
import { FeedbackProvider } from '../feedback/FeedbackProvider';
import { copy } from './Documents.copy';
export function DocumentsTabletView({ model, actions, presentation }: SurfaceProps<DocumentBrowserProps>) {
  return <FeedbackProvider><main className="app-shell documents-tablet" data-surface="tablet" data-orientation={presentation.orientation}>
    <DocumentNavigation model={model} actions={actions} />
    {!model.snapshot && <DocumentsWorkspace model={model} actions={actions} />}
    <p role="status">{model.status}</p>{model.error && <p role="alert">{model.error}</p>}
    {model.snapshot && <section className="tablet-document-workspace">
      <details className="tablet-document-list" open={presentation.orientation === 'landscape' || !model.documentFullscreen}>
        <summary>{copy.title}</summary><label>{copy.find}<input type="search" value={model.query} onChange={e => actions.setQuery(e.target.value)} /></label>
        <DocumentTree model={model} actions={actions} />
      </details>
      <DocumentsReading model={model} actions={actions} />
    </section>}
  </main></FeedbackProvider>;
}
