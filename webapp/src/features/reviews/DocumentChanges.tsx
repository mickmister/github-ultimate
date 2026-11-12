import { useEffect, useRef, useState } from 'react';
import { DocumentChangesView } from './DocumentChanges.view';

export function DocumentChanges({ path, before, after }: { path: string; before: string; after: string }) {
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
