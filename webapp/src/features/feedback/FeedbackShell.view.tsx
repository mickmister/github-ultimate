import { ark } from '@ark-ui/react/factory';
import { Menu } from '@ark-ui/react/menu';
import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import type { ReactNode } from 'react';
import type { FeedbackCapture, FeedbackKind, FeedbackModel } from './contracts';
import './feedback.css';
import { FeedbackRegion } from './Feedback.presentation';
import { feedbackCopy as copy } from './Feedback.copy';

interface Props extends Omit<FeedbackModel, 'api'> {
  uiSuppressed?: boolean;
  children: ReactNode;
}
export function FeedbackShellView({ children, active, composer, review, state, notice, commentRef, dockRef, textareaRef, returnFocusEl, portalContainer, selectionPoint, actions, uiSuppressed = false }: Props) {
  const container = portalContainer ? { current: portalContainer } : undefined;
  return <>
    <Menu.Root aria-label={copy.commentActions.text} open={!uiSuppressed && Boolean(active)} positioning={{ placement: 'bottom-start', strategy: 'fixed' }}
      onOpenChange={details => { if (!uiSuppressed && !details.open) actions.closeMenu(); }} onSelect={details => actions.select(details.value)}
      onEscapeKeyDown={event => event.stopPropagation()} lazyMount unmountOnExit>
      <Menu.Trigger disabled aria-hidden="true" className="feedback-menu-anchor" style={{ left: active?.point.x ?? 0, top: active?.point.y ?? 0 }} />
      {children}
      <Portal container={container}><Menu.Positioner className="feedback-menu-positioner"><Menu.Content className="feedback-menu" aria-label={copy.commentActions.text}>
        <Menu.Item value="copy" disabled={!active?.context.selection}>{copy.copy.text}</Menu.Item>
        <Menu.Separator />
        <Menu.Item value="content-comment" disabled={!active?.context.target.resource}>{copy.contentComment.text}</Menu.Item>
        <Menu.Item value="feature-comment">{copy.featureComment.text}</Menu.Item>
      </Menu.Content></Menu.Positioner></Portal>
    </Menu.Root>
    {!uiSuppressed && selectionPoint && <Portal container={container}><button type="button" className="feedback-selection-action" data-feedback-control="true"
      style={{ left: selectionPoint.x, top: selectionPoint.y }} onPointerDown={event => event.preventDefault()} onClick={actions.openSelection}>{copy.selectionComment.text}</button></Portal>}
    {!uiSuppressed && <Portal container={container}><div className="feedback-dock" data-feedback-control="true">
      <button ref={dockRef} type="button" onClick={event => actions.openReview(event.currentTarget)}>{copy.comments.text}{copy.countSeparator.text}{state.items.length}</button>
      {(notice || state.message) && <p aria-live="polite">{notice || state.message}</p>}
    </div></Portal>}
    <Dialog.Root open={!uiSuppressed && Boolean(composer || review)} onOpenChange={details => { if (!uiSuppressed && !details.open) actions.closeDialog(); }}
      initialFocusEl={() => composer ? commentRef.current : null} finalFocusEl={returnFocusEl} onEscapeKeyDown={event => event.stopPropagation()} lazyMount unmountOnExit>
      <Portal container={container}><Dialog.Backdrop className="feedback-backdrop" /><Dialog.Positioner className="feedback-dialog-positioner">
        <Dialog.Content className="feedback-dialog" data-feedback-control="true" aria-label={composer ? composer.kind === 'content-comment' ? copy.contentComment.text : copy.featureComment.text : copy.queue.text}>
          <header><Dialog.Title>{composer ? composer.kind === 'content-comment' ? copy.contentComment.text : copy.featureComment.text : copy.queue.text}</Dialog.Title>
            <button type="button" onClick={actions.closeDialog} aria-label={copy.closeComments.text}>{copy.close.text}</button></header>
          <Dialog.Description>{copy.draft.text}</Dialog.Description>
          <FeedbackRegion context={composer ? <>
             <p><strong>{composer.context.target.label}</strong></p>
             <CaptureDetails context={composer.context} kind={composer.kind} />
              <blockquote>{composer.context.selection?.text ?? copy.wholeElement.text}</blockquote>
              <details><summary>{copy.routingHeading.text}</summary><p>{copy.routing.text}</p></details>
             </> : <p>{copy.routing.text}</p>} editor={composer ? <form id="feedback-composer-form" onSubmit={event => { event.preventDefault(); actions.addComment(); }}>
            <label htmlFor="feedback-new-comment">{copy.comment.text}</label><textarea id="feedback-new-comment" ref={textareaRef('composer')} value={composer.text} onChange={event => actions.setComment(event.target.value)} rows={4} />
           </form> : <>
            {!state.items.length && <p>{copy.empty.text}</p>}
            <ol className="feedback-queue">{state.items.map((item, index) => <li key={item.id}>
               <h3>{index + 1}{copy.numberSeparator.text}{item.context.target.label}</h3>
              <p>{item.kind === 'content-comment' ? copy.content.text : copy.feature.text}</p>
              <CaptureDetails context={item.context} kind={item.kind} />
              {item.context.selection && <blockquote>{item.context.selection.text}</blockquote>}
              <label htmlFor={`feedback-comment-${item.id}`}>{copy.numberedComment.text} {index + 1}</label><textarea id={`feedback-comment-${item.id}`} ref={textareaRef(item.id)} value={item.comment} rows={3} onChange={event => actions.edit(item.id, event.target.value)} />
              <button type="button" onClick={() => actions.remove(item.id)} aria-label={`${copy.removeComment.text} ${index + 1}`}>{copy.remove.text}</button>
            </li>)}</ol>
          </>} footer={composer ? <button type="submit" form="feedback-composer-form" disabled={!composer.text.trim()}>{copy.add.text}</button> :
            (['content-comment', 'feature-comment'] as const).map(kind => <ark.button data-ui="feedback-category-export" key={kind} type="button" disabled={!state.items.some(item => item.kind === kind) || state.exporting} onClick={() => actions.copyAndClear(kind)}>{state.exporting ? copy.copying.text : kind === 'content-comment' ? copy.copyContent.text : copy.copyFeature.text}</ark.button>)} />
          {(notice || state.message) && <p aria-live="polite">{notice || state.message}</p>}
        </Dialog.Content>
      </Dialog.Positioner></Portal>
    </Dialog.Root>
  </>;
}

function CaptureDetails({ context, kind }: { context: FeedbackCapture; kind: FeedbackKind }) {
  const resource = context.target.resource;
  return <details><summary>{copy.context.text}</summary><p>{context.target.uiPath.join(' → ')}</p>
    <p className="feedback-context-detail">{kind === 'content-comment' ? resource?.path ?? resource?.id : context.target.featureId}</p>
    {resource && <dl className="feedback-context-detail">
      {resource.repository && <><dt>{copy.repository.text}</dt><dd>{resource.repository}</dd></>}
      {resource.workspace && <><dt>{copy.workspace.text}</dt><dd>{resource.workspace}</dd></>}
      {resource.revision && <><dt>{copy.revision.text}</dt><dd>{resource.revision}</dd></>}
    </dl>}
  </details>;
}
