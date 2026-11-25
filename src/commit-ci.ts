import { z } from 'zod';

const oid = z.string().regex(/^[a-f0-9]{40}$/);
export const commitCiRequestSchema = z.object({ operation: z.literal('commitCi'), id: z.string().uuid(), installationId: z.number().int().positive(),
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/).max(220), ref: z.string().min(1).max(1024).refine(value => /^[a-f0-9]{40}$/.test(value) || value.startsWith('refs/heads/') && value.length > 11 && !/[\x00-\x20?#]/.test(value)),
}).strict();
const state = z.enum(['success', 'failure', 'pending', 'unknown', 'none']);
export const commitCiSchema = z.object({ repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/), sha: oid, ref: z.string(), checkedAt: z.string().datetime(), state, partial: z.boolean(),
  checks: z.array(z.object({ id: z.string(), name: z.string(), state, detail: z.string(), url: z.string().optional() })), errors: z.array(z.string()),
});
export type CommitCi = z.infer<typeof commitCiSchema>;
export function aggregateCi(states: CommitCi['state'][], partial = false): CommitCi['state'] {
  if (states.includes('failure')) return 'failure';
  if (states.includes('pending')) return 'pending';
  if (partial || states.includes('unknown')) return 'unknown';
  if (states.includes('none')) return states.every(state => state === 'none') ? 'none' : 'unknown';
  return states.length ? 'success' : 'none';
}
function checkState(status: string, conclusion: string | null): CommitCi['state'] {
  if (status !== 'completed') return 'pending';
  if (['success', 'neutral', 'skipped'].includes(conclusion ?? '')) return 'success';
  return ['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale'].includes(conclusion ?? '') ? 'failure' : 'unknown';
}
/** Resolve a moving branch once, then read every CI source by that exact SHA.
 * Missing permissions and bounded inventories must never become a green badge. */
export async function readCommitCi(repository: string, ref: string, read: (path: string) => Promise<unknown>, now = () => new Date()): Promise<CommitCi> {
  const sha = /^[a-f0-9]{40}$/.test(ref) ? ref : z.object({ sha: oid }).parse(await read(`/commits/${encodeURIComponent(ref)}`)).sha;
  const checks: CommitCi['checks'] = [], errors: string[] = [];
  let partial = false;
  const collect = async (label: string, path: string, field: string, consume: (items: any[]) => void) => {
    try {
      for (let page = 1; page <= 5; page++) {
        const result = z.record(z.string(), z.unknown()).parse(await read(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`));
        if (result.sha !== undefined && result.sha !== sha) throw Error('CI source commit changed.');
        const items = z.array(z.record(z.string(), z.any())).max(100).parse(result[field]);
        consume(items);
        if (items.length < 100 || typeof result.total_count === 'number' && page * 100 >= result.total_count) return;
      }
      partial = true; errors.push(`${label} inventory incomplete.`);
    } catch { partial = true; errors.push(`${label} unavailable.`); }
  };
  await collect('Checks', `/commits/${sha}/check-runs?filter=latest`, 'check_runs', items => {
    for (const item of items) {
      if (item.head_sha !== sha || typeof item.name !== 'string' || typeof item.status !== 'string' || !Number.isSafeInteger(item.id)) throw Error('Invalid check binding.');
      checks.push({ id: `check:${item.id}`, name: item.name, state: checkState(item.status, item.conclusion), detail: item.conclusion ?? item.status, url: typeof item.html_url === 'string' ? item.html_url : undefined });
    }
  });
  const contexts = new Set<string>();
  await collect('Commit statuses', `/commits/${sha}/status`, 'statuses', items => {
    for (const item of items) {
      if (typeof item.context !== 'string' || !['success', 'pending', 'failure', 'error'].includes(item.state)) throw Error('Invalid commit status.');
      if (contexts.has(item.context)) continue;
      contexts.add(item.context);
      checks.push({ id: `status:${item.context}`, name: item.context, state: item.state === 'error' ? 'failure' : item.state, detail: item.state, url: typeof item.target_url === 'string' ? item.target_url : undefined });
    }
  });
  const workflows = new Set<string>();
  await collect('Actions', `/actions/runs?head_sha=${sha}`, 'workflow_runs', items => {
    // GitHub returns newest runs first. Group by workflow/event/branch so a new
    // rerun supersedes its previous failure, without hiding a different workflow.
    for (const item of items) {
      if (item.head_sha !== sha || !Number.isSafeInteger(item.id) || !Number.isSafeInteger(item.workflow_id) || typeof item.status !== 'string') throw Error('Invalid Actions commit binding.');
      const key = JSON.stringify([item.workflow_id, item.event, item.head_branch]);
      if (workflows.has(key)) continue;
      workflows.add(key);
      checks.push({ id: `actions:${item.id}`, name: item.name ?? `Workflow ${item.workflow_id}`, state: checkState(item.status, item.conclusion), detail: item.conclusion ?? item.status, url: `https://github.com/${repository}/actions/runs/${item.id}` });
    }
  });
  return { repository, sha, ref, checkedAt: now().toISOString(), state: aggregateCi(checks.map(check => check.state), partial), partial, checks, errors };
}
