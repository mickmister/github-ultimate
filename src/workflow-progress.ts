import { z } from 'zod';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { actionJobSchema } from './actions-protocol';
import { workflowProgressSchema, type WorkflowDelivery, type WorkflowObservation } from './workflow-interface';

export async function readWorkflowProgress(delivery: WorkflowDelivery, run: { id: number; run_attempt: number }, read: (path: string) => Promise<unknown>): Promise<Pick<WorkflowObservation, 'jobs' | 'jobsPartial' | 'progress' | 'progressState'>> {
  const executionId = `${run.id}-${run.run_attempt}`;
  const external = `pi-development:${bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([delivery.workspace, delivery.thread, delivery.process, executionId]))))}`;
  const [jobs, progress] = await Promise.allSettled([
    read(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=1`).then(value => {
      const page = z.object({ total_count: z.number().int().nonnegative(), jobs: z.array(actionJobSchema).max(100) }).parse(value);
      return { jobs: page.jobs, jobsPartial: page.jobs.length < page.total_count };
    }),
    (async () => {
      const matches: any[] = [];
      for (let page = 1; page <= 10; page++) {
        const listing = z.object({ check_runs: z.array(z.any()).max(100) }).parse(await read(`/commits/${delivery.engineCommit}/check-runs?filter=all&per_page=100&page=${page}`));
        matches.push(...listing.check_runs.filter(check => check.external_id === external && check.head_sha === delivery.engineCommit && check.app?.slug === 'github-actions'));
        if (listing.check_runs.length < 100) break;
        if (page === 10) throw Error('Progress check inventory incomplete.');
      }
      if (matches.length !== 1) throw Error('No unique exact progress check.');
      const text = matches[0].output?.text;
      if (typeof text !== 'string' || text.length > 64000) throw Error('Invalid progress observation.');
      const match = /^```json\n([^\n]+)\n```$/.exec(text);
      if (!match) throw Error('Missing compact progress contract.');
      const value = workflowProgressSchema.parse(JSON.parse(match[1]));
      if (value.executionId !== executionId || value.workspace !== delivery.workspace || value.thread !== delivery.thread || value.process !== delivery.process) throw Error('Progress execution binding mismatch.');
      return value;
    })(),
  ]);
  return { ...(jobs.status === 'fulfilled' ? jobs.value : { jobsPartial: true }),
    ...(progress.status === 'fulfilled' ? { progress: progress.value, progressState: 'available' } : { progressState: 'unavailable-or-unconfirmed' }) };
}
