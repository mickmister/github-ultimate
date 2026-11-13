import { renderDocumentMarkdown } from '../documents/markdown';
import type { PreviewServices } from './preview';

/** Explicit adapter for this renderer implementation at a host-supplied build. */
export function currentDocumentAdapters(appBuild: string): Pick<PreviewServices, 'feature' | 'representation'> {
  const features = new Set(['documents.browser', 'documents.tree', 'documents.markdown-renderer', 'documents.source-editor']);
  return {
    feature: (id, build) => build === appBuild && features.has(id),
    representation(resource, representation, build) {
      if (representation !== 'rendered-markdown' || build !== appBuild || resource.text === undefined) return undefined;
      const host = document.createElement('div');
      host.innerHTML = renderDocumentMarkdown(resource.text);
      // Diagrams asynchronously replace code blocks with SVG; those need their
      // own renderer-specific checkpoint rather than pretending source is a view.
      if (host.querySelector('code.language-mermaid')) return undefined;
      return host.textContent ?? '';
    },
  };
}
