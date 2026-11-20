import { WorkspaceActions, WorkspaceLinks, WorkspacePicker, WorkspaceStatus, type BeadsPageProps } from './BeadsSample.view';
import { BeadsBoardPresentation } from './BeadsBoard.presentation';
import { copy } from './Beads.copy';
export function BeadsTabletView(props: BeadsPageProps) {
  return <main className="app-shell beads-page beads-page-tablet" data-page-surface="tablet">
    <header className="beads-page-header"><h1>{copy.tasks}</h1><WorkspaceLinks {...props} /></header>
    <div className="beads-tablet-scope"><WorkspaceActions {...props} /><WorkspacePicker {...props} /></div>
    <WorkspaceStatus {...props} />{props.model.loadedChoice && <BeadsBoardPresentation {...props.board} />}
  </main>;
}
