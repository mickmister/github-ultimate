import type { DocumentBrowserProps } from './contracts';
import { isMarkdown } from './document-format';
import { MarkdownDocument } from './MarkdownDocument';
import { MonacoDocument } from './MonacoDocument';
import { AttachableContext } from '../feedback/AttachableContext';
import { FeedbackAnnotations } from '../feedback/FeedbackAnnotations';
import { documentFeedbackTarget } from './feedback-target';
import { copy } from './Documents.copy';

export function DocumentsReading({ model, actions }: DocumentBrowserProps) {
  const selected = model.snapshot?.documents.find(d => d.id === model.documentId);
  const markdown = selected && model.documentMode === 'markdown' && isMarkdown(selected.path);
  const target = selected && documentFeedbackTarget(model, selected, markdown ? 'documents.markdown-renderer' : 'documents.source-editor', markdown ? 'rendered-markdown' : 'source');
  return <article className="document-preview"><header><h2>{selected?.path ?? copy.select}</h2>
    {selected && <details><summary>{copy.details}</summary><p>{copy.readonly}</p><code>{model.snapshot?.commit}</code></details>}
  </header>{selected && model.content !== null && target ? <>
    <div className="document-toolbar"><div role="group" aria-label={copy.view}>
      <button aria-pressed={model.documentMode === 'source'} onClick={() => actions.setDocumentMode('source')}>{copy.source}</button>
      {isMarkdown(selected.path) && <button aria-pressed={model.documentMode === 'markdown'} onClick={() => actions.setDocumentMode('markdown')}>{copy.markdown}</button>}
    </div></div>
    <AttachableContext key={`${model.documentMode}:${selected.id}`} target={target}><FeedbackAnnotations target={target} showRepresentation={r => actions.setDocumentMode(r === 'source' ? 'source' : 'markdown')}>
      {markdown ? <MarkdownDocument content={model.content} /> : <MonacoDocument key={selected.id} path={selected.path} content={model.content} />}
    </FeedbackAnnotations></AttachableContext>
  </> : <><p className="document-placeholder" aria-label={copy.content}>{model.documentId && model.busy ? copy.reading : selected && model.error ? copy.readError : copy.select}</p>
    {selected && model.error && <button onClick={() => actions.selectDocument(selected.id)}>{copy.retry}</button>}</>}
  </article>;
}
