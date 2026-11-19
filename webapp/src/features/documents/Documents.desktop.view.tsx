import type { SurfaceProps } from '../../presentation/Presentation';
import type { DocumentBrowserProps } from './contracts';
import { DocumentNavigation } from './DocumentNavigation';
import { DocumentsWorkspace } from './DocumentsWorkspace.view';
import { DocumentsReading } from './DocumentsReading.view';
import { DocumentTree } from './DocumentTree';
import { FeedbackProvider } from '../feedback/FeedbackProvider';
import { copy } from './Documents.copy';
export function DocumentsDesktopView({ model, actions, presentation }: SurfaceProps<DocumentBrowserProps>) {
  const reading = model.documentFullscreen && Boolean(model.snapshot?.documents.some(d => d.id === model.documentId));
  return <FeedbackProvider><main className={`app-shell documents-desktop${reading ? ' document-fullscreen' : ''}`} data-surface="desktop" data-orientation={presentation.orientation}>
    <DocumentNavigation model={model} actions={actions} />
    {!reading && <DocumentsWorkspace model={model} actions={actions} />}
    <p role="status">{model.status}</p>{model.error && <p role="alert">{model.error}</p>}
    {model.snapshot && <section className="browser">
      {!reading && <aside className="document-sidebar"><h2>{copy.title}</h2><label>{copy.find}<input type="search" value={model.query} onChange={e => actions.setQuery(e.target.value)} /></label>
        <details className="tree-appearance"><summary>{copy.treeAppearance}</summary>
          <label>{copy.density}<select value={model.treeAppearance.density} onChange={e => actions.setTreeAppearance({ ...model.treeAppearance, density: e.target.value === 'compact' ? 'compact' : 'comfortable' })}><option value="comfortable">{copy.comfortable}</option><option value="compact">{copy.compact}</option></select></label>
          <label>{copy.accent}<select value={model.treeAppearance.accent} onChange={e => actions.setTreeAppearance({ ...model.treeAppearance, accent: e.target.value === 'blue' ? 'blue' : e.target.value === 'teal' ? 'teal' : 'default' })}><option value="default">{copy.default}</option><option value="blue">{copy.blue}</option><option value="teal">{copy.teal}</option></select></label>
        </details><DocumentTree model={model} actions={actions} /></aside>}
      <DocumentsReading model={model} actions={actions} />
    </section>}
  </main></FeedbackProvider>;
}
