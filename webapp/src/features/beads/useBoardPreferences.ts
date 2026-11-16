import { useEffect, useRef, useState } from 'react';
import { applicationStorage } from '../../app-storage';
import { boardPreferencesKey, defaultPreferences, readPreferences, type BoardPreferences } from './preferences';

export function useBoardPreferences(scope: string | undefined, initialDensity: 'compact' | 'comfortable') {
  const [preferences, setPreferences] = useState(() => defaultPreferences(initialDensity));
  const [ready, setReady] = useState(!scope), [error, setError] = useState('');
  const [saving, setSaving] = useState(false), revision = useRef(0);
  const storage = useRef<Awaited<ReturnType<typeof applicationStorage>> | undefined>(undefined), key = useRef('');
  const current = useRef(preferences);
  useEffect(() => {
    let stopped = false;
    if (!scope) { setReady(true); return; }
    setReady(false);
    void Promise.all([applicationStorage(), boardPreferencesKey(scope)]).then(([opened, name]) => {
      if (stopped) return;
      storage.current = opened; key.current = name;
      current.current = readPreferences(opened.getItem(name), initialDensity);
      setPreferences(current.current); setReady(true);
    }).catch(() => { if (!stopped) { setError('Saved filters could not be restored.'); setReady(true); } });
    return () => { stopped = true; storage.current = undefined; key.current = ''; };
  }, [scope, initialDensity]);
  function update(change: (current: BoardPreferences) => BoardPreferences) {
    let next: BoardPreferences;
    try { next = change(current.current); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Filter settings could not be saved.'); return; }
    current.current = next; setPreferences(next); setError('');
    if (!scope) return;
    const attempt = ++revision.current;
    try {
      const serialized = JSON.stringify(next);
      if (serialized.length > 4096) throw new Error('Saved filters are full. Delete a filter or shorten its search.');
      if (!storage.current || !key.current) throw new Error('Filter settings could not be saved.');
      storage.current.setItem(key.current, serialized);
      setSaving(true);
      void storage.current.flush().catch(() => { if (attempt === revision.current) setError('Filter settings could not be saved.'); })
        .finally(() => { if (attempt === revision.current) setSaving(false); });
    } catch (reason) { setSaving(false); setError(reason instanceof Error ? reason.message : 'Filter settings could not be saved.'); }
  }
  return { preferences, ready, saving, error, update };
}
