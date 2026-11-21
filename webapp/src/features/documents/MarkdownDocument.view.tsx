import type { Ref } from 'react';

export function MarkdownDocumentView({ html, previewRef }: { html: string; previewRef: Ref<HTMLElement> }) {
  return <section ref={previewRef} aria-label="Markdown preview" className="markdown-preview" tabIndex={0} dangerouslySetInnerHTML={{ __html: html }} />;
}
