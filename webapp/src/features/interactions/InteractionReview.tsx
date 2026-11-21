import { useEffect, useId, useRef, useState } from 'react';
import { documentsV1Adapter, importBatch, type BatchBinding } from './batch';
import { previewBatch, type InteractionPreview, type PreviewServices } from './preview';
import { InteractionReviewView } from './InteractionReview.view';

export interface InteractionReviewProps { readonly binding: BatchBinding; readonly services: PreviewServices }

/** Production read-only review surface. No clipboard reads, queue clearing, writes or dispatch. */
export function InteractionReview({ binding, services }: InteractionReviewProps) {
  const inputId = useId();
  const [json, setJson] = useState('');
  const [legacy, setLegacy] = useState(false);
  const [preview, setPreview] = useState<InteractionPreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  function invalidate() { active.current?.abort(); setBusy(false); setPreview(null); setError(''); }
  useEffect(() => { invalidate(); return () => active.current?.abort(); }, [binding, services]);
  return <InteractionReviewView inputId={inputId} json={json} legacy={legacy} preview={preview} error={error} busy={busy} actions={{
    setJson(value) { invalidate(); setJson(value); },
    setLegacy(value) { invalidate(); setLegacy(value); },
    async review() {
      invalidate();
      const controller = new AbortController(); active.current = controller; setBusy(true);
      try {
        const batch = importBatch(json, binding, legacy ? documentsV1Adapter(binding) : undefined);
        const result = await previewBatch(batch, binding, services, controller.signal);
        if (!controller.signal.aborted) setPreview(result);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to preview this batch.');
      } finally { if (!controller.signal.aborted) setBusy(false); }
    },
  }} />;
}
