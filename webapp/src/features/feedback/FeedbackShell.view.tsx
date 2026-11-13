import { Menu } from '@ark-ui/react/menu';
import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import type { ReactNode, RefObject } from 'react';
import type { FeedbackCapture, FeedbackKind } from './contracts';
import type { createFeedbackQueue } from './queue';
import './feedback.css';

interface Props {
  children: ReactNode;
  active: { context: FeedbackCapture; point: { x: number; y: number } } | null;
  composer: { kind: FeedbackKind; context: FeedbackCapture; text: string } | null;
  review: boolean;
  state: ReturnType<ReturnType<typeof createFeedbackQueue>['getSnapshot']>;
  notice: string;
  commentRef: RefObject<HTMLTextAreaElement | null>;
  portalContainer: HTMLElement | null;
  actions: {
    closeMenu(): void; select(value: string): void; openReview(element: HTMLElement): void; closeDialog(): void;
    setComment(text: string): void; addComment(): void; edit(id: string, text: string): void;
    remove(id: string): void; copyAndClear(): void;
  };
}
export function FeedbackShellView({ children, active, composer, review, state, notice, commentRef, portalContainer, actions }: Props) {
  const container = portalContainer ? { current: portalContainer } : undefined;
  return <>
    <Menu.Root aria-label="Comment actions" open={Boolean(active)} positioning={{ placement: 'bottom-start', strategy: 'fixed' }}
      onOpenChange={details => { if (!details.open) actions.closeMenu(); }} onSelect={details => actions.select(details.value)}
      onEscapeKeyDown={event => event.stopPropagation()} lazyMount unmountOnExit>
      <Menu.Trigger disabled aria-hidden="true" tabIndex={-1} className="feedback-menu-anchor" style={{ left: active?.point.x ?? 0, top: active?.point.y ?? 0 }} />
      {children}
      <Portal container={container}><Menu.Positioner className="feedback-menu-positioner"><Menu.Content className="feedback-menu" aria-label="Comment actions">
        <Menu.Item value="copy" disabled={!active?.context.selection}>Copy</Menu.Item>
        <Menu.Separator />
        <Menu.Item value="content-comment" disabled={!active?.context.target.resource}>Comment on Content</Menu.Item>
        <Menu.Item value="feature-comment">Comment on Feature</Menu.Item>
      </Menu.Content></Menu.Positioner></Portal>
    </Menu.Root>
    <Portal container={container}><div className="feedback-dock" data-feedback-control="true">
      <button type="button" onClick={event => actions.openReview(event.currentTarget)}>Comments · {state.items.length}</button>
      {(notice || state.message) && <p aria-live="polite">{notice || state.message}</p>}
    </div></Portal>
    <Dialog.Root open={Boolean(composer || review)} onOpenChange={details => { if (!details.open) actions.closeDialog(); }}
      initialFocusEl={() => composer ? commentRef.current : null} onEscapeKeyDown={event => event.stopPropagation()} lazyMount unmountOnExit>
      <Portal container={container}><Dialog.Backdrop className="feedback-backdrop" /><Dialog.Positioner className="feedback-dialog-positioner">
        <Dialog.Content className="feedback-dialog" data-feedback-control="true" aria-label={composer ? composer.kind === 'content-comment' ? 'Comment on Content' : 'Comment on Feature' : 'Queued comments'}>
          <header><Dialog.Title>{composer ? composer.kind === 'content-comment' ? 'Comment on Content' : 'Comment on Feature' : 'Queued comments'}</Dialog.Title>
            <button type="button" onClick={actions.closeDialog} aria-label="Close comments">Close</button></header>
          <Dialog.Description>{composer ? 'Add your thought with the captured UI context and highlighted content.' : 'Review your thoughts, then copy a compact Markdown review to paste into agent chat. Drafts stay in this tab until copied.'}</Dialog.Description>
          {composer ? <form onSubmit={event => { event.preventDefault(); actions.addComment(); }}>
            <p><strong>{composer.context.target.label}</strong><br />{composer.context.target.uiPath.join(' → ')}</p>
            <p className="feedback-context-detail">{composer.kind === 'content-comment' ? composer.context.target.resource?.path ?? composer.context.target.resource?.id : composer.context.target.featureId}</p>
            <blockquote>{composer.context.selection?.text ?? 'Whole element — no highlighted text.'}</blockquote>
            <label htmlFor="feedback-new-comment">Your comment</label><textarea id="feedback-new-comment" ref={commentRef} value={composer.text} onChange={event => actions.setComment(event.target.value)} rows={4} />
            <button type="submit" disabled={!composer.text.trim()}>Add to queue</button>
          </form> : <>
            {!state.items.length && <p>No comments queued.</p>}
            <ol className="feedback-queue">{state.items.map((item, index) => <li key={item.id}>
              <h3>{index + 1}. {item.context.target.label}</h3>
              <p>{item.kind === 'content-comment' ? 'Content' : 'Feature'} · {item.context.target.uiPath.join(' → ')}</p>
              <p className="feedback-context-detail">{item.kind === 'content-comment' ? item.context.target.resource?.path ?? item.context.target.resource?.id : item.context.target.featureId}</p>
              {item.context.selection && <blockquote>{item.context.selection.text}</blockquote>}
              <label htmlFor={`feedback-comment-${item.id}`}>Comment {index + 1}</label><textarea id={`feedback-comment-${item.id}`} value={item.comment} rows={3} onChange={event => actions.edit(item.id, event.target.value)} />
              <button type="button" onClick={() => actions.remove(item.id)} aria-label={`Remove comment ${index + 1}`}>Remove</button>
            </li>)}</ol>
            <button type="button" disabled={!state.items.length || state.exporting} onClick={actions.copyAndClear}>{state.exporting ? 'Copying…' : 'Copy review & clear'}</button>
          </>}
          {(notice || state.message) && <p aria-live="polite">{notice || state.message}</p>}
        </Dialog.Content>
      </Dialog.Positioner></Portal>
    </Dialog.Root>
  </>;
}
