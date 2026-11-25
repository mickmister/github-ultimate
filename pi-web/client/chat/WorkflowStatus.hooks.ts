'use client';
import { useEffect, useState } from 'react';
import type { ChatHandle, ChatWorkflow } from '../../../hosted/pi-chat-contract';
import { workflowNeedsRefresh } from '../../../hosted/pi-chat-contract';

export function workflowTerminal(workflow: ChatWorkflow) { return workflow.observation?.executionState === 'completed'; }
export function workflowElapsed(workflow: ChatWorkflow, now: number) {
  const observation = workflow.observation;
  const start = Date.parse(observation?.startedAt ?? observation?.createdAt ?? workflow.execution.attemptedAt);
  const ends = observation?.jobs?.map(job => job.completed_at ? Date.parse(job.completed_at) : NaN) ?? [];
  const stop = workflowTerminal(workflow) ? ends.length && !observation?.jobsPartial && ends.every(Number.isFinite) ? Math.max(...ends) : Date.parse(workflow.observedAt ?? '') : now;
  if (!Number.isFinite(start) || !Number.isFinite(stop) || stop < start) return 'Timing unavailable';
  const seconds = Math.floor((stop - start) / 1000), minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m ${seconds % 60}s` : `${minutes}m ${seconds % 60}s`;
}
export function useWorkflowStatus(chat: ChatHandle | undefined, workflows: ChatWorkflow[]) {
  const [now, setNow] = useState(() => Date.now()), [offline, setOffline] = useState(false), [error, setError] = useState(false);
  const keys = workflows.filter(workflowNeedsRefresh).map(workflow => workflow.execution.executionReference).sort().join(',');
  const pollingDelay = workflows.some(workflow => !workflowTerminal(workflow)) ? 10000 : 60000;
  useEffect(() => {
    if (!chat?.refreshWorkflows || !keys) return;
    let disposed = false, timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | undefined, failures = 0;
    const schedule = () => { if (!disposed && document.visibilityState !== 'hidden') timer = setTimeout(() => void poll(), Math.min(120000, pollingDelay * 2 ** Math.min(failures, 3))); };
    const poll = async () => {
      clearTimeout(timer);
      if (disposed || document.visibilityState === 'hidden') return;
      if (!navigator.onLine) { setOffline(true); schedule(); return; }
      setOffline(false); const attempt = new AbortController(); controller = attempt;
      try { await chat.refreshWorkflows!(attempt.signal); if (!disposed && !attempt.signal.aborted) { failures = 0; setError(false); } }
      catch { if (!disposed && !attempt.signal.aborted) { failures++; setError(true); } }
      finally { if (!attempt.signal.aborted) schedule(); }
    };
    const resume = () => {
      clearTimeout(timer); controller?.abort();
      if (document.visibilityState !== 'hidden') void poll();
    };
    document.addEventListener('visibilitychange', resume); window.addEventListener('online', resume); window.addEventListener('offline', resume);
    void poll();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); window.removeEventListener('offline', resume); };
  }, [chat, keys, pollingDelay]);
  useEffect(() => {
    if (!keys) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [keys]);
  return { workflows, now, offline, error };
}
export type WorkflowStatusModel = ReturnType<typeof useWorkflowStatus>;
