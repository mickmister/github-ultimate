import type { RefObject } from 'react';
import { LoadingIndicator } from '../../views/LoadingIndicator.view';

export function MonacoDocumentView({ editorRef, content, ready, error }: {
  editorRef: RefObject<HTMLDivElement | null>; content: string; ready: boolean; error: string | null;
}) {
  return <section aria-label="Document content" className="source-document" data-editor-ready={ready}>
    {error ? <p role="alert">{error}</p> : !ready && <LoadingIndicator compact label="Loading source editor…" />}
    <div ref={editorRef} className="monaco-host" hidden={Boolean(error)} />
    {(!ready || error) && <pre className="source-fallback" tabIndex={0}>{content}</pre>}
  </section>;
}
