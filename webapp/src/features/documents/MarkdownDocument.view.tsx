export function MarkdownDocumentView({ html }: { html: string }) {
  return <section aria-label="Markdown preview" className="markdown-preview" tabIndex={0} dangerouslySetInnerHTML={{ __html: html }} />;
}
