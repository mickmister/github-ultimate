import { useEffect, useMemo, useRef } from 'react';
import { renderDocumentMarkdown } from '../documents/markdown';
import { renderDocumentDiagrams } from '../documents/markdown-diagrams';
import { diffMarkdownBlocks } from './markdown-block-diff';
import { MarkdownChangesView } from './MarkdownChanges.view';

function renderedBlocks(source: string): string[] {
  const container = document.createElement('div');
  // Render each complete revision first, preserving reference links and Markdown
  // structure. Only sanitized HTML from the normal document renderer enters the diff.
  container.innerHTML = renderDocumentMarkdown(source);
  return Array.from(container.childNodes).filter(node => node.nodeType !== Node.TEXT_NODE || node.textContent?.trim()).map(node => {
    const block = document.createElement('div');
    block.append(node.cloneNode(true));
    return block.innerHTML;
  });
}

export function MarkdownChanges({ before, after }: { before: string; after: string }) {
  const changes = useMemo(() => diffMarkdownBlocks(renderedBlocks(before), renderedBlocks(after)), [before, after]);
  const preview = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (preview.current) void renderDocumentDiagrams(preview.current, controller.signal);
    return () => controller.abort();
  }, [changes]);
  return <MarkdownChangesView changes={changes} previewRef={preview} />;
}
