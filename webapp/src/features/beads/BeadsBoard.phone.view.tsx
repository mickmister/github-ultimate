import { BoardControls, BoardStatus, BoardDetails, BoardPagination, BeadsCardView, type BoardProps } from './BeadsBoard.view';
import { copy } from './Beads.copy';
export function BeadsBoardPhoneView(props: BoardProps) {
  return <section className="beads-board beads-board-phone" aria-label={copy.board} data-board-surface="phone">
    {props.model.selected ? <BoardDetails {...props} phone /> : <><BoardControls {...props} /><BoardStatus {...props} />
      <div className="beads-task-list">{props.model.columns.map(column => {
        const cards = props.model.pageCards.filter(card => card.column === column.id);
        return cards.length > 0 && <section key={column.id}><h2>{column.label}</h2><ul>{cards.map(card => <li key={card.id}><BeadsCardView card={card} /></li>)}</ul></section>;
      })}</div><BoardPagination {...props} /></>}
  </section>;
}
