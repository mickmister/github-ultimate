'use client';
import { useEffect, useState } from 'react';
import type { ChatWorkspace } from '../../../hosted/pi-chat-contract';
import type { WorkspaceCi } from '../../../hosted/ci-status';
import { runtime } from './runtime';

export function useWorkspaceCi(workspace: ChatWorkspace | undefined) {
  const repository = workspace?.repository, name = workspace?.workspace;
  const key = workspace ? JSON.stringify([workspace.repository, workspace.workspace]) : '';
  const [observation, setObservation] = useState<{ key: string; value?: WorkspaceCi; error?: string }>();
  useEffect(() => {
    if (!repository || !name) return;
    const selected = { repository, workspace: name };
    let disposed = false, generation = 0, failures = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      clearTimeout(timer);
      if (disposed || document.visibilityState === 'hidden') return;
      const attempt = ++generation;
      try {
        if (!navigator.onLine) throw Error('Offline. Latest workspace CI may be stale.');
        const api = await runtime();
        if (!api.workspaceCi) throw Error('Update the host to read workspace CI.');
        const value = await api.workspaceCi(selected);
        if (disposed || attempt !== generation) return;
        if (value.workspace.workspace !== name || value.workspace.repository !== repository) throw Error('Workspace CI identity changed.');
        failures = 0; setObservation({ key, value });
      } catch (error) {
        if (disposed || attempt !== generation) return;
        failures++;
        setObservation(previous => ({ key, value: previous?.key === key ? previous.value : undefined, error: error instanceof Error ? error.message : 'Workspace CI unavailable.' }));
      }
      if (!disposed && attempt === generation) timer = setTimeout(() => void poll(), Math.min(120000, 30000 * 2 ** Math.min(failures, 2)));
    };
    const resume = () => { generation++; clearTimeout(timer); if (document.visibilityState !== 'hidden') void poll(); };
    document.addEventListener('visibilitychange', resume); window.addEventListener('online', resume); window.addEventListener('offline', resume);
    void poll();
    return () => { disposed = true; generation++; clearTimeout(timer); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); window.removeEventListener('offline', resume); };
  }, [key, repository, name]);
  return { enabled: Boolean(workspace), value: observation?.key === key ? observation.value : undefined, error: observation?.key === key ? observation.error : undefined };
}
export type WorkspaceCiModel = ReturnType<typeof useWorkspaceCi>;
