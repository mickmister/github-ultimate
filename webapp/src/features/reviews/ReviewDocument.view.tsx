import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { ReviewDocumentProps } from './ReviewDocument';

export function ReviewDocumentView({ title, children, busy, onSaveDraft, formStatus, zen, onZen, dialog, zenButton, heading }: ReviewDocumentProps & {
  dialog: RefObject<HTMLDialogElement | null>;
  zenButton: RefObject<HTMLButtonElement | null>; heading: RefObject<HTMLHeadingElement | null>;
}) {
  return zen ? createPortal(<dialog ref={dialog} className="review-zen" aria-label={`${title} — Zen mode`} onCancel={event => { event.preventDefault(); onZen(false); }}>
    <header className="review-zen-toolbar"><button type="button" className="review-zen-back" onClick={() => onZen(false)}>← Back</button></header>
    <div className="review-zen-content review-zen-document-content">
      <h2 ref={heading} tabIndex={-1}>{title}</h2>
      {children}
      {onSaveDraft && <div className="review-form-actions">
        <button type="button" disabled={busy} onClick={onSaveDraft}>Save draft remotely</button>
        {formStatus && <><p role="status">{busy ? 'Saving draft…' : `${formStatus.dirty ? 'Unsaved changes. ' : ''}${formStatus.notice}`}</p>{formStatus.error && <p role="alert">{formStatus.error}</p>}</>}
      </div>}
    </div>
  </dialog>, document.body) : <><button ref={zenButton} type="button" className="review-zen-toggle" onClick={() => onZen(true)}>Zen mode</button>{children}</>;
}
