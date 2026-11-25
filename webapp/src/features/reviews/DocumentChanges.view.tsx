import type { RefObject } from 'react';
export function DocumentChangesView({ editorRef, error, unchanged }: { editorRef: RefObject<HTMLDivElement | null>; error: string; unchanged: boolean }) {
  return <section aria-label="Document changes">{unchanged && <p>No text changes between these pinned revisions.</p>}{error && <p role="alert">{error}</p>}<div ref={editorRef} className="review-diff" /></section>;
}
