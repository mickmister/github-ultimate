import { useMemo } from 'react';
import { renderDocumentMarkdown } from './markdown';
import { MarkdownDocumentView } from './MarkdownDocument.view';

export function MarkdownDocument({ content }: { content: string }) {
  const html = useMemo(() => renderDocumentMarkdown(content), [content]);
  return <MarkdownDocumentView html={html} />;
}
