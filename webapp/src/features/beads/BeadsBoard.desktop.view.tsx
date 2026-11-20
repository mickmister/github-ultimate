import { BoardControls, BoardStatus, BoardDetails, DesktopKanban, type BoardProps } from './BeadsBoard.view';
import { copy } from './Beads.copy';
export function BeadsBoardDesktopView(props: BoardProps) {
  return <section className="beads-board beads-board-desktop" aria-label={copy.board} data-board-surface="desktop">
    <BoardControls {...props} /><BoardStatus {...props} />
    <div className="beads-desktop-workspace" data-details={Boolean(props.model.selected)}><DesktopKanban {...props} /><BoardDetails {...props} /></div>
  </section>;
}
