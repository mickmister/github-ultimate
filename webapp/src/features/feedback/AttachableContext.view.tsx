import { cloneElement, isValidElement, type ReactNode, type ReactElement, type Ref, type HTMLAttributes, type MouseEvent, type KeyboardEvent } from 'react';

interface DOMProps extends HTMLAttributes<HTMLElement> { ref?: Ref<HTMLElement> }
interface Props {
  id: string; label: string; asChild: boolean; showButton: boolean; children: ReactNode;
  rootRef(element: HTMLElement | null): void;
  actions: {
    contextMenu(event: MouseEvent<HTMLElement>): void;
    contextMenuCapture(event: MouseEvent<HTMLElement>): void;
    keyboard(event: KeyboardEvent<HTMLElement>): void;
    capture(): void;
    comment(trigger: HTMLElement): void;
  };
}
export function AttachableContextView({ id, label, asChild, showButton, rootRef, actions, children }: Props) {
  const props = {
    'data-feedback-target': id,
    onContextMenu: actions.contextMenu,
    onContextMenuCapture: actions.contextMenuCapture,
    onKeyDown: actions.keyboard,
    onPointerDownCapture: actions.capture,
    onSelectCapture: actions.capture,
  };
  if (asChild) {
    if (!isValidElement(children)) throw new Error('AttachableContext asChild requires one React element.');
    const child = children as ReactElement<DOMProps>;
    return cloneElement(child, {
      ...props,
      ref(element) {
        rootRef(element);
        const original = child.props.ref;
        const cleanup = typeof original === 'function' ? original(element) : undefined;
        if (original && typeof original !== 'function') original.current = element;
        if (element) return () => {
          rootRef(null);
          if (typeof cleanup === 'function') cleanup();
          else if (typeof original === 'function') original(null);
          else if (original) original.current = null;
        };
      },
      onContextMenu(event) { child.props.onContextMenu?.(event); if (!event.defaultPrevented) actions.contextMenu(event); },
      onContextMenuCapture(event) { child.props.onContextMenuCapture?.(event); if (!event.defaultPrevented) actions.contextMenuCapture(event); },
      onKeyDown(event) { child.props.onKeyDown?.(event); if (!event.defaultPrevented) actions.keyboard(event); },
      onPointerDownCapture(event) { child.props.onPointerDownCapture?.(event); actions.capture(); },
      onSelectCapture(event) { child.props.onSelectCapture?.(event); actions.capture(); },
    });
  }
  return <div {...props} ref={rootRef} className="attachable-context" tabIndex={-1}>
    {showButton && <div className="feedback-target-actions"><button type="button" data-feedback-control="true"
      aria-label={`Comment on ${label}`} onClick={event => { event.stopPropagation(); actions.comment(event.currentTarget); }}>Comment ⋯</button></div>}
    {children}
  </div>;
}

export function FeedbackTriggerView({ label, actions }: { label: string; actions: { capture(element: HTMLElement): void; open(element: HTMLElement): void } }) {
  return <button type="button" className="feedback-row-trigger" data-feedback-control="true" aria-label={`Comment on ${label}`}
    onPointerDown={event => { event.stopPropagation(); actions.capture(event.currentTarget); }}
    onKeyDown={event => event.stopPropagation()}
    onClick={event => { event.stopPropagation(); actions.open(event.currentTarget); }}>⋯</button>;
}
