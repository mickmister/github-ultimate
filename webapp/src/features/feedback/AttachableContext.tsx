import { useContext, useEffect, useId, useRef, type ReactNode, type MouseEvent, type KeyboardEvent } from 'react';
import type { FeedbackSelection, FeedbackTarget } from './contracts';
import { AttachableParentContext, useFeedback } from './FeedbackProvider';
import { captureFeedbackSelection } from './selection';
import { AttachableContextView, FeedbackTriggerView } from './AttachableContext.view';

export interface AttachableContextProps {
  target: FeedbackTarget;
  children: ReactNode;
  asChild?: boolean;
  showButton?: boolean;
}
export function AttachableContext({ target, children, asChild = false, showButton = true }: AttachableContextProps) {
  const api = useFeedback();
  const parent = useContext(AttachableParentContext);
  const descriptor = { ...target, uiPath: [...(parent?.uiPath ?? []), ...target.uiPath], resource: target.resource ?? parent?.resource };
  const id = useId();
  const root = useRef<HTMLElement | null>(null);
  const pending = useRef<FeedbackSelection | null | undefined>(undefined);
  useEffect(() => { pending.current = undefined; }, [target.elementId, target.representation, descriptor.resource?.id, descriptor.resource?.repository, descriptor.resource?.workspace, descriptor.resource?.revision]);
  function open(event: MouseEvent<HTMLElement>) {
    if (!root.current || (event.target as Element).closest('[data-feedback-target]') !== root.current) return;
    event.preventDefault(); event.stopPropagation();
    api.open(descriptor, root.current, root.current, { x: event.clientX, y: event.clientY });
  }
  function keyboard(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault(); event.stopPropagation();
    if (root.current) api.open(descriptor, root.current, event.target as HTMLElement);
  }
  function comment(trigger: HTMLElement) {
    if (root.current) api.open(descriptor, root.current, trigger, undefined, pending.current);
  }
  return <AttachableParentContext.Provider value={descriptor}>
    <AttachableContextView id={id} label={target.label} asChild={asChild} showButton={showButton}
      rootRef={element => { root.current = element; }}
      actions={{
        contextMenu: open, keyboard, comment,
        capture() { if (root.current) pending.current = captureFeedbackSelection(root.current, descriptor.representation); },
        contextMenuCapture(event) {
          // Monaco owns its DOM events; intercept only its nearest explicitly attached boundary.
          if ((event.target as Element).closest('[data-feedback-selection]')) open(event);
        },
      }}>{children}</AttachableContextView>
  </AttachableParentContext.Provider>;
}

/** An explicit touch/keyboard action for rows whose existing DOM must remain unchanged. */
export function FeedbackTrigger({ label }: { label: string }) {
  const api = useFeedback(), target = useContext(AttachableParentContext);
  const pending = useRef<FeedbackSelection | null>(null);
  return <FeedbackTriggerView label={label} actions={{
    capture(element) {
      const root = element.closest<HTMLElement>('[data-feedback-target]');
      if (root) pending.current = captureFeedbackSelection(root, target?.representation);
    },
    open(element) {
      const root = element.closest<HTMLElement>('[data-feedback-target]');
      if (root && target) api.open(target, root, element, undefined, pending.current);
    },
  }} />;
}
