import { WorkspaceActions, WorkspaceLinks, WorkspacePicker, WorkspaceStatus, type BeadsPageProps } from './BeadsSample.view';
import { BeadsBoardPresentation } from './BeadsBoard.presentation';
import { copy } from './Beads.copy';
export function BeadsDesktopView(props: BeadsPageProps) {
  return <main className="app-shell beads-page beads-page-desktop" data-page-surface="desktop">
    <header className="beads-page-header"><h1>{copy.title}</h1><WorkspaceActions {...props} /><WorkspaceLinks {...props} /></header>
    <div className="beads-desktop-scope"><WorkspacePicker {...props} /><WorkspaceStatus {...props} /></div>
    {props.model.loadedChoice && <BeadsBoardPresentation {...props.board} />}
  </main>;
}
