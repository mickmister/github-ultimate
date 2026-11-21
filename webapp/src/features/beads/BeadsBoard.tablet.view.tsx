import { BoardControls, BoardStatus, BoardDetails, BoardPagination, BeadsCardView, type BoardProps } from './BeadsBoard.view';
import { copy } from './Beads.copy';
export function BeadsBoardTabletView(props: BoardProps) {
  return <section className="beads-board beads-board-tablet" aria-label={copy.board} data-board-surface="tablet">
    <BoardControls {...props} /><BoardStatus {...props} />
    <div className="beads-tablet-workspace" data-details={Boolean(props.model.selected)}><div className="beads-tablet-browser"><div className="beads-compact-lanes">{props.model.columns.map(column => <section key={column.id} className="beads-compact-lane"><h2>{column.label}</h2><ul>{props.model.pageCards.filter(card => card.column === column.id).map(card => <li key={card.id}><BeadsCardView card={card} /></li>)}</ul></section>)}</div><BoardPagination {...props} /></div>
      <BoardDetails {...props} />
    </div>
  </section>;
}
