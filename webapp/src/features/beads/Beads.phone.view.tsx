import { WorkspaceActions, WorkspaceLinks, WorkspacePicker, WorkspaceStatus, type BeadsPageProps } from './BeadsSample.view';
import { BeadsBoardPresentation } from './BeadsBoard.presentation';
import { copy } from './Beads.copy';
export function BeadsPhoneView(props: BeadsPageProps) {
  return <main className="app-shell beads-page beads-page-phone" data-page-surface="phone">
    <header className="beads-page-header"><h1>{copy.tasks}</h1><WorkspaceActions {...props} /></header>
    <WorkspacePicker {...props} /><WorkspaceStatus {...props} />
    {props.model.loadedChoice && <BeadsBoardPresentation {...props.board} />}
    <footer><WorkspaceLinks {...props} /></footer>
  </main>;
}
