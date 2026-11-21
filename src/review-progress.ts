import { z } from 'zod';
import { reviewOid, type ReviewReceipt } from './review-protocol';

export const reviewProgressSchema = z.object({
  operation: z.literal('reviewProgress'), id: z.string().uuid(), installationId: z.number().int().positive(),
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/).max(220), workspace: z.string().min(1).max(160),
  resource: z.string().regex(/^review-requests\/[A-Za-z0-9_-]+\/responses\/[A-Za-z0-9_-]+\.json$/), version: reviewOid,
}).strict();
export interface ReviewWorkflowProgress {
  state: 'unknown' | 'not-found' | 'queued' | 'running' | 'completed';
  checked_at: string; dispatch?: ReviewReceipt['dispatch']; message?: string;
  run?: { id: number; url: string; status: string; conclusion: string | null };
}
/** Correlate an immutable response, never just the latest run of this process. */
export function responseRun(runs: any[], version: string, repository: string, branch: string, actor: number): Omit<ReviewWorkflowProgress, 'checked_at' | 'dispatch'> {
  const matches = runs.filter(run => run && run.event === 'workflow_dispatch' && run.head_branch === branch && run.actor?.id === actor
    && typeof run.display_title === 'string' && run.display_title.split(' · ').includes(version));
  if (!matches.length) return { state: 'not-found', message: 'No exactly correlated run is visible yet. Older workflows do not expose response correlation; this does not prove delivery failed.' };
  if (matches.length !== 1) return { state: 'unknown', message: 'Multiple runs match this response. Open Actions to reconcile their outcomes; no run was selected automatically.' };
  const run = matches[0];
  if (!Number.isSafeInteger(run.id) || run.id < 1 || run.html_url !== `https://github.com/${repository}/actions/runs/${run.id}`) throw Error('Invalid workflow run evidence.');
  return {state: run.status === 'completed' ? 'completed' : run.status === 'in_progress' ? 'running' : ['queued','waiting','pending','requested'].includes(run.status) ? 'queued' : 'unknown',
    run: {id: run.id, url: run.html_url, status: run.status, conclusion: run.conclusion ?? null}};
}
