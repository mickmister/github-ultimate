import type { RefObject } from 'react';

export function MonacoDocumentView({ editorRef, content, ready, error }: {
  editorRef: RefObject<HTMLDivElement | null>; content: string; ready: boolean; error: string | null;
}) {
  return <section aria-label="Document content" className="source-document" data-editor-ready={ready}>
    {error ? <p role="alert">{error}</p> : !ready && <p role="status">Loading source editor…</p>}
    <div ref={editorRef} className="monaco-host" hidden={Boolean(error)} />
    {(!ready || error) && <pre className="source-fallback" tabIndex={0}>{content}</pre>}
  </section>;
}
