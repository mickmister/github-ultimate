import type { MouseEvent, ReactNode, RefObject } from 'react';
import type { FeedbackComment } from './contracts';
import type { AnnotationPosition } from './FeedbackAnnotations';

interface Props {
  id: string; children: ReactNode; comments: readonly FeedbackComment[]; allItems: readonly FeedbackComment[]; activeId: string | null;
  layout: { positions: AnnotationPosition[]; height: number }; representation?: string; canChangeRepresentation: boolean;
  contentRef: RefObject<HTMLDivElement | null>; bodyRef: RefObject<HTMLDivElement | null>;
  actions: {
    cardRef(id: string, element: HTMLElement | null): void; activate(id: string, focus?: boolean): void;
    reveal(item: FeedbackComment): void; edit(id: string, text: string): void; remove(id: string): void;
    clickText(event: MouseEvent<HTMLDivElement>): void;
  };
}
export function FeedbackAnnotationsView({ id, children, comments, allItems, activeId, layout, representation, canChangeRepresentation, contentRef, bodyRef, actions }: Props) {
  const number = (commentId: string) => allItems.findIndex(item => item.id === commentId) + 1;
  const ordered = [...comments].sort((left, right) => (layout.positions.find(position => position.id === left.id)?.top ?? Infinity) - (layout.positions.find(position => position.id === right.id)?.top ?? Infinity));
  return <div className={`feedback-annotated-document${comments.length ? ' has-comments' : ''}`}>
    <div className="feedback-document-body" ref={bodyRef} tabIndex={-1} style={{ minHeight: Math.max(0, ...layout.positions.filter(position => !position.status).map(position => position.markerTop + 48)) }}>
      <div ref={contentRef} data-feedback-content="true" onClick={actions.clickText}>{children}</div>
      <div className="feedback-document-highlights" aria-hidden="true">{layout.positions.flatMap(position => position.rects.map((rect, index) =>
        <span key={`${position.id}:${index}`} data-comment-id={position.id} className={`feedback-text-highlight${activeId === position.id ? ' is-active' : ''}`} style={rect} />))}</div>
      {layout.positions.filter(position => !position.status).map(position => <button key={position.id} type="button" className="feedback-comment-marker" data-feedback-control="true"
        style={{ top: position.markerTop }} aria-label={`Show comment ${number(position.id)}`} aria-controls={`${id}-${position.id}`} aria-pressed={activeId === position.id}
        onClick={() => actions.activate(position.id, true)}>{number(position.id)}</button>)}
    </div>
    {comments.length > 0 && <aside className="feedback-document-comments" aria-label="Document comments" data-feedback-control="true" style={{ minHeight: layout.height }}
      onContextMenu={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <h2>Queued comments · {comments.length}</h2>
      <ol>{ordered.map(item => {
        const position = layout.positions.find(value => value.id === item.id);
        const selectedElsewhere = item.context.selection && item.context.selection.representation !== representation;
        return <li key={item.id} className={`feedback-inline-comment${activeId === item.id ? ' is-active' : ''}`} style={{ top: position?.top ?? 42 }}
          id={`${id}-${item.id}`} ref={element => actions.cardRef(item.id, element)} tabIndex={-1} onFocusCapture={() => actions.activate(item.id)}>
          <h3>Comment {number(item.id)} <small>· {item.kind === 'content-comment' ? 'Content' : 'Feature'}</small></h3>
          {item.context.selection && <blockquote>{item.context.selection.text}</blockquote>}
          {position?.status && <p className="feedback-anchor-status">{position.status}</p>}
          {item.context.selection && (!position?.status || selectedElsewhere && canChangeRepresentation && ['source', 'rendered-markdown'].includes(item.context.selection.representation)) && <button type="button" onClick={() => actions.reveal(item)}>{selectedElsewhere ? 'Show selected view' : 'Show passage'}</button>}
          <label htmlFor={`${id}-edit-${item.id}`}>Edit queued comment {number(item.id)}</label>
          <textarea id={`${id}-edit-${item.id}`} value={item.comment} rows={3} onChange={event => actions.edit(item.id, event.target.value)} />
          <button type="button" aria-label={`Delete queued comment ${number(item.id)}`} onClick={() => actions.remove(item.id)}>Delete</button>
        </li>;
      })}</ol>
    </aside>}
  </div>;
}
