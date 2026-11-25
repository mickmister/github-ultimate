import type { SurfaceProps } from '../../presentation/Presentation';
import type { DocumentBrowserProps } from './contracts';
import { copy } from './Documents.copy';
export function DocumentNavigationTabletView({ model, actions, presentation }: SurfaceProps<DocumentBrowserProps>) {
  const query = new URLSearchParams({ repository: model.repository, workspace: model.workspaceId, connection: model.connectionId });
  return <header className="document-tablet-navigation" data-region="documents.navigation" data-orientation={presentation.orientation}>
    <h1>{copy.title}</h1><nav aria-label={copy.pages}><a href={`#/agent?${query}`}>{copy.agent}</a>{model.workspaceId && <a href={`../pi-web/?${query}`} target="_blank" rel="noopener noreferrer">{copy.piWeb}</a>}<a href={`#/runs?${query}`}>{copy.runs}</a><a href={`#/reviews?${query}`}>{copy.reviews}</a><a href={`#/beads?${query}`}>{copy.tasks}</a></nav>
    {model.documentFullscreen && <button autoFocus onClick={() => actions.setDocumentFullscreen(false)}>{copy.back}</button>}
  </header>;
}
