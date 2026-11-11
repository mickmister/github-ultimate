import { useEffect, useMemo, useRef } from 'react';
import { renderDocumentMarkdown } from './markdown';
import { MarkdownDocumentView } from './MarkdownDocument.view';
import { renderDocumentDiagrams } from './markdown-diagrams';

export function MarkdownDocument({ content }: { content: string }) {
  const html = useMemo(() => renderDocumentMarkdown(content), [content]);
  const previewRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (previewRef.current) void renderDocumentDiagrams(previewRef.current, controller.signal);
    return () => controller.abort();
  }, [html]);
  return <MarkdownDocumentView html={html} previewRef={previewRef} />;
}
