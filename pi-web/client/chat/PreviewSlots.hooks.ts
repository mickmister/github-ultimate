'use client';
import { useRef, useState } from 'react';
import type { PreviewCatalog } from '../../../hosted/preview-slots';

export function usePreviewSlots(load: () => Promise<PreviewCatalog>) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [catalog, setCatalog] = useState<PreviewCatalog>();
  const generation = useRef(0);
  async function refresh() {
    const current = ++generation.current; setBusy(true); setError(''); setCatalog(undefined);
    try { const result = await load(); if (current === generation.current) setCatalog(result); return result; }
    catch (error) { if (current === generation.current) setError(error instanceof Error ? error.message : 'Preview slots could not be loaded.'); }
    finally { if (current === generation.current) setBusy(false); }
  }
  function toggle(next: boolean) { setOpen(next); if (next && !open) void refresh(); }
  return { open, busy, error, catalog, toggle, refresh };
}
export type PreviewSlotsModel = ReturnType<typeof usePreviewSlots>;
