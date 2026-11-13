import { write } from './storage';

/** Persistence observes snapshots; it never parses text, renders, or edits controls. */
export function draftPersistence(key: string, enabled: boolean, snapshot: () => unknown, onError: (message: string) => void) {
  let changed = false, dirty = false, disposed = false, version = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    if (!enabled || !dirty) return;
    dirty = false;
    const saving = version;
    void write(key, snapshot()).then(() => {
      if (!disposed && saving === version) onError('');
    }).catch(() => {
      if (saving === version) dirty = true;
      if (!disposed && saving === version) onError('Could not save draft locally. Keep this page open or copy your answers.');
    });
  };
  const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', flush);
  return {
    get changed() { return changed; },
    change(defer = false) {
      changed = true; dirty = true; version++; clearTimeout(timer);
      if (enabled && !defer) timer = setTimeout(flush, 250);
    },
    dispose() {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      flush();
    },
  };
}
