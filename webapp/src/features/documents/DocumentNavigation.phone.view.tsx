import type { SurfaceProps } from '../../presentation/Presentation';
import type { DocumentBrowserProps } from './contracts';
import { copy } from './Documents.copy';
export function DocumentNavigationPhoneView({ model, actions, presentation }: SurfaceProps<DocumentBrowserProps>) {
  return <header className="document-phone-navigation" data-region="documents.navigation" data-orientation={presentation.orientation}>
    {model.documentFullscreen ? <button autoFocus onClick={() => actions.setDocumentFullscreen(false)}>{copy.back}</button> : <h1>{copy.title}</h1>}
    <nav aria-label={copy.pages}><a href={`#/runs?${new URLSearchParams({ repository: model.repository, workspace: model.workspaceId, connection: model.connectionId })}`}>{copy.runs}</a><a href={`#/reviews?${new URLSearchParams({ repository: model.repository, workspace: model.workspaceId, connection: model.connectionId })}`}>{copy.reviews}</a></nav>
  </header>;
}
