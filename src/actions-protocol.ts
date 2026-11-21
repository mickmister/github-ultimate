import { z } from 'zod';

const positive = z.number().int().positive().safe();
export const actionsReadSchema = z.object({
  operation: z.literal('actionsRead'), id: z.string().uuid(), installationId: positive,
  repository: z.string().regex(/^[a-zA-Z0-9][\w.-]*\/[a-zA-Z0-9][\w.-]*$/).max(220), run: positive, attempt: positive,
  kind: z.enum(['run', 'jobs', 'artifacts']), page: positive.max(100).default(1),
}).strict();
export type ActionsRead = z.input<typeof actionsReadSchema>;
export const actionRunSchema = z.object({
  id: positive, run_attempt: positive, name: z.string().nullable(), display_title: z.string(),
  created_at: z.string().datetime(), run_started_at: z.string().datetime().nullable().optional(),
  status: z.string().nullable(), conclusion: z.string().nullable(), head_sha: z.string(), head_branch: z.string().nullable(), html_url: z.string().url(),
});
export type ActionRun = z.infer<typeof actionRunSchema>;
export const actionJobSchema = z.object({ id: positive, name: z.string(), status: z.string(), conclusion: z.string().nullable(), started_at: z.string().datetime().nullable(), completed_at: z.string().datetime().nullable() });
export type ActionJob = z.infer<typeof actionJobSchema>;
export const actionArtifactSchema = z.object({ id: positive, name: z.string(), size_in_bytes: z.number().int().nonnegative(), expired: z.boolean(), expires_at: z.string().nullable(), created_at: z.string() });
export type ActionArtifact = z.infer<typeof actionArtifactSchema>;
export function actionPath(request: z.output<typeof actionsReadSchema>) {
  const base = `/repos/${request.repository}/actions/runs/${request.run}`;
  return request.kind === 'run' ? `${base}/attempts/${request.attempt}` : request.kind === 'jobs'
    ? `${base}/attempts/${request.attempt}/jobs?per_page=100&page=${request.page}` : `${base}/artifacts?per_page=100&page=${request.page}`;
}
export function actionResult(request: z.output<typeof actionsReadSchema>, value: unknown) {
  if (request.kind === 'jobs') return z.object({ total_count: z.number().int().nonnegative(), jobs: z.array(actionJobSchema).max(100) }).parse(value);
  if (request.kind === 'artifacts') return z.object({ total_count: z.number().int().nonnegative(), artifacts: z.array(actionArtifactSchema).max(100) }).parse(value);
  const run = actionRunSchema.parse(value);
  if (run.id !== request.run || run.run_attempt !== request.attempt || run.html_url !== `https://github.com/${request.repository}/actions/runs/${request.run}`) throw Error('Actions attempt identity mismatch.');
  return run;
}
export function jobTiming(jobs: ActionJob[], now = Date.now()) {
  const started = jobs.filter(job => job.started_at).map(job => Date.parse(job.started_at!));
  if (!started.length) return { label: 'Not started', milliseconds: null, summed: null };
  const running = jobs.some(job => job.status !== 'completed');
  if (jobs.some(job => job.status === 'completed' && job.conclusion !== 'skipped' && (!job.started_at || !job.completed_at))) return { label: 'Timing unavailable', milliseconds: null, summed: null };
  const ended = jobs.filter(job => job.started_at).map(job => job.completed_at ? Date.parse(job.completed_at) : now);
  if (ended.some((end, index) => end < started[index])) return { label: 'Timing unavailable', milliseconds: null, summed: null };
  return { label: running ? 'Live job window' : 'Job window', milliseconds: (running ? Math.max(now, ...ended) : Math.max(...ended)) - Math.min(...started), summed: ended.reduce((sum, end, index) => sum + end - started[index], 0) };
}
