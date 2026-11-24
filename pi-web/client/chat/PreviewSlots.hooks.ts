'use client';
import { useRef, useState } from 'react';
import type { PreviewCatalog } from '../../../hosted/preview-slots';

export function usePreviewSlots(load: () => Promise<PreviewCatalog>) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [catalog, setCatalog] = useState<PreviewCatalog>();
  const pending = useRef(false);
  async function refresh() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setCatalog(undefined);
    try { setCatalog(await load()); }
    catch (error) { setError(error instanceof Error ? error.message : 'Preview slots could not be loaded.'); }
    finally { pending.current = false; setBusy(false); }
  }
  function toggle(next: boolean) { setOpen(next); if (next && !open) void refresh(); }
  return { open, busy, error, catalog, toggle, refresh };
}
export type PreviewSlotsModel = ReturnType<typeof usePreviewSlots>;
