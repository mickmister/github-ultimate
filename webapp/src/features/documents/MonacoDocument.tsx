import { useEffect, useRef, useState } from 'react';
import { MonacoDocumentView } from './MonacoDocument.view';

export function MonacoDocument({ path, content }: { path: string; content: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false, dispose: (() => void) | undefined;
    setReady(false); setError(null);
    void import('./monaco-runtime').then(({ mountDocumentEditor }) => {
      if (cancelled || !host.current) return;
      dispose = mountDocumentEditor(host.current, path, content);
      setReady(true);
    }).catch(() => {
      if (!cancelled) setError('The source editor could not load. Document text is available below.');
    });
    return () => { cancelled = true; dispose?.(); };
  }, [path, content]);
  return <MonacoDocumentView editorRef={host} content={content} ready={ready} error={error} />;
}
