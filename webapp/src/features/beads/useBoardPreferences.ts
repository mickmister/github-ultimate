import { useEffect, useRef, useState } from 'react';
import { applicationStorage } from '../../app-storage';
import { boardPreferencesKey, defaultPreferences, readPreferences, type BoardPreferences } from './preferences';
import { settingsError } from './settings-error';

export function useBoardPreferences(scope: string | undefined, initialDensity: 'compact' | 'comfortable') {
  const [preferences, setPreferences] = useState(() => defaultPreferences(initialDensity));
  const [ready, setReady] = useState(!scope), [error, setError] = useState('');
  const [saving, setSaving] = useState(false), revision = useRef(0);
  const storage = useRef<Awaited<ReturnType<typeof applicationStorage>> | undefined>(undefined), key = useRef('');
  const storageFailure = useRef<unknown>(undefined);
  const current = useRef(preferences);
  useEffect(() => {
    let stopped = false;
    if (!scope) { setReady(true); return; }
    setReady(false);
    void Promise.all([applicationStorage(), boardPreferencesKey(scope)]).then(([opened, name]) => {
      if (stopped) return;
      storage.current = opened; key.current = name; storageFailure.current = undefined;
      current.current = readPreferences(opened.getItem(name), initialDensity);
      setPreferences(current.current); setError(''); setReady(true);
    }).catch(reason => { if (!stopped) { storageFailure.current = reason; setError(settingsError('Filter', reason)); setReady(true); } });
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
      if (!storage.current || !key.current) throw storageFailure.current ?? new Error('Preference storage is unavailable.');
      storage.current.setItem(key.current, serialized);
      setSaving(true);
      void storage.current.flush().catch(reason => { if (attempt === revision.current) setError(settingsError('Filter', reason)); })
        .finally(() => { if (attempt === revision.current) setSaving(false); });
    } catch (reason) { setSaving(false); setError(settingsError('Filter', reason)); }
  }
  return { preferences, ready, saving, error, update, dismissError: () => setError('') };
}
