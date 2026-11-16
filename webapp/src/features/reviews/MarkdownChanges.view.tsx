import type { Ref } from 'react';
import type { MarkdownChange } from './markdown-block-diff';

export function MarkdownChangesView({ changes, previewRef }: { changes: MarkdownChange[]; previewRef: Ref<HTMLDivElement> }) {
  const changed = changes.some(change => change.kind !== 'unchanged');
  return <section aria-label="Document changes" className="review-markdown-changes">
    <p className="muted">Rendered Markdown changes against the pinned baseline. Changed blocks show the removed version followed by the added version.</p>
    {!changed && <p role="status">No rendered changes between these pinned revisions.</p>}
    <div ref={previewRef} className="markdown-preview review-markdown-diff">
      {changes.map((change, index) => <div key={index} className="review-markdown-change" data-change={change.kind}>
        {change.kind !== 'unchanged' && <p className="review-markdown-change-label">{change.kind === 'added' ? '+ Added' : '− Removed'}</p>}
        <div dangerouslySetInnerHTML={{ __html: change.blocks.join('\n') }} />
      </div>)}
    </div>
  </section>;
}
