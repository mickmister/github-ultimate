import DOMPurify from 'dompurify';
import mermaidUrl from '@mermaid-js/tiny/dist/mermaid.tiny.js?url';

let nextDiagramId = 0;
interface MermaidRenderer {
  initialize(config: { startOnLoad: boolean; securityLevel: 'strict'; suppressErrorRendering: boolean; htmlLabels: boolean }): void;
  render(id: string, source: string, container: HTMLElement): Promise<{ svg: string }>;
}

// The official tiny build is a standalone browser script. Serve it from the
// app's own asset base and load it only when a document contains a diagram.
const loadMermaid = () => new Promise<MermaidRenderer>((resolve, reject) => {
  const script = document.createElement('script');
  script.src = mermaidUrl;
  script.onload = () => {
    try {
      const mermaid = (window as Window & { mermaid?: MermaidRenderer }).mermaid;
      if (!mermaid) throw new Error('Mermaid did not initialize.');
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, htmlLabels: false });
      resolve(mermaid);
    } catch (error) {
      reject(error);
    } finally {
      script.remove();
    }
  };
  script.onerror = () => { script.remove(); reject(new Error('Unable to load Mermaid.')); };
  document.head.append(script);
});
let renderer: ReturnType<typeof loadMermaid> | undefined;

export async function renderDocumentDiagrams(preview: HTMLElement, signal: AbortSignal): Promise<void> {
  const blocks = preview.querySelectorAll('pre > code.language-mermaid');
  if (!blocks.length) return;
  for (const code of blocks) {
    if (signal.aborted) return;
    const staging = document.createElement('div');
    staging.style.cssText = 'position:absolute;left:-100000px;top:0;';
    staging.setAttribute('aria-hidden', 'true');
    try {
      const mermaid = await (renderer ??= loadMermaid());
      if (signal.aborted) return;
      document.body.append(staging);
      const { svg } = await mermaid.render(`document-mermaid-${++nextDiagramId}`, code.textContent ?? '', staging);
      if (signal.aborted) return;
      const diagram = document.createElement('div');
      diagram.className = 'markdown-diagram';
      diagram.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
      diagram.setAttribute('role', 'img');
      diagram.setAttribute('aria-label', 'Mermaid diagram');
      code.parentElement?.replaceWith(diagram);
    } catch {
      if (signal.aborted) return;
      const message = document.createElement('p');
      message.className = 'markdown-diagram-error';
      message.textContent = 'Unable to render Mermaid diagram. Diagram source is shown below.';
      code.parentElement?.before(message);
    } finally {
      staging.remove();
    }
  }
}
