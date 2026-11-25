import { useEffect, useRef, useState } from 'react';
import { DocumentChangesView } from './DocumentChanges.view';
import { isMarkdown } from '../documents/document-format';
import { MarkdownChanges } from './MarkdownChanges';

interface Props { path: string; before: string; after: string }
export function DocumentChanges(props: Props) {
  return isMarkdown(props.path) ? <MarkdownChanges before={props.before} after={props.after} /> : <SourceChanges {...props} />;
}

function SourceChanges({ path, before, after }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false, dispose: (() => void) | undefined;
    setError('');
    void import('../documents/monaco-runtime').then(runtime => {
      if (!cancelled && host.current) dispose = runtime.mountDocumentDiff(host.current, path, before, after);
    }).catch(() => { if (!cancelled) setError('The changes editor could not load. Inspect the pinned baseline and full document instead.'); });
    return () => { cancelled = true; dispose?.(); };
  }, [path, before, after]);
  return <DocumentChangesView editorRef={host} error={error} unchanged={before === after} />;
}
