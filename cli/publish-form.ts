import { spawnSync } from 'node:child_process';
import { parseRecord, type TaskForm } from '../src/protocol.ts';

export type Gh = (args: string[], input?: string) => string;
export type Target = { repository: string; number: number; url: string };
export type PublishOptions = { repository?: string; pr?: number; submissionId?: string; dryRun?: boolean };
export type Environment = Record<string, string | undefined>;
export type Publication = Target & { formId: string; body: string; dryRun: boolean; reused: boolean; commentId?: number; commentUrl?: string };

export const gh: Gh = (args, input) => {
  const result = spawnSync('gh', args, { input, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw new Error(`Cannot run gh: ${result.error.message}. Install GitHub CLI and authenticate with gh auth login or GH_TOKEN.`);
  if (result.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${result.stderr.trim().slice(0, 2000) || `exit ${result.status}`}`);
  return result.stdout.trim();
};

function repositoryName(value: string): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) || value.split('/').some(part => part === '.' || part === '..')) throw new Error('Repository must be owner/repo on github.com.');
  return value;
}
export function prNumber(value: unknown): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('PR number must be a positive integer.');
  return number;
}
function submissionId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value)) throw new Error('Submission ID must be 1–160 letters, numbers, dots, colons, underscores or hyphens.');
  return value;
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function nested(value: unknown, ...keys: string[]): unknown {
  for (const key of keys) value = object(value)?.[key];
  return value;
}

export function formFromDsl(input: string): TaskForm {
  if (input.length > 100000) throw new Error('Form input exceeds 100 KB.');
  let source = input.trim();
  // Accept the DSL itself, or exactly one form fence in a complete example comment.
  if (!source.startsWith('{') && !source.startsWith('---')) {
    const fences = [...source.matchAll(/^```(?:github-task|json|yaml|yml)[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm)];
    if (fences.length > 1) throw new Error('Provide one form per invocation, not multiple fenced records.');
    if (fences.length === 1) source = fences[0][1];
  }
  const form = parseRecord(source);
  if (!('format' in form)) throw new Error('Expected standard form DSL, not a response or workflow snapshot.');
  return form;
}

export function eventPr(event: unknown, repository: string): number | undefined {
  const eventRepository = nested(event, 'repository', 'full_name') ?? nested(event, 'pull_request', 'base', 'repo', 'full_name');
  if (eventRepository && String(eventRepository).toLowerCase() !== repository.toLowerCase()) throw new Error('Event repository differs from target repository. Supply --pr explicitly for an intentional cross-repository publication.');
  if (object(nested(event, 'pull_request'))) return prNumber(nested(event, 'pull_request', 'number') ?? nested(event, 'number'));
  if (object(nested(event, 'issue', 'pull_request'))) return prNumber(nested(event, 'issue', 'number'));
  if (object(nested(event, 'issue'))) throw new Error('This event concerns an issue, not a PR. Supply --pr explicitly to target a PR intentionally.');
  const prs = nested(event, 'workflow_run', 'pull_requests');
  if (Array.isArray(prs) && prs.length) {
    if (prs.length !== 1) throw new Error('Workflow run references multiple PRs. Supply --pr explicitly.');
    return prNumber(nested(prs[0], 'number'));
  }
}

export function resolveTarget(options: PublishOptions, env: Environment, event: unknown, run: Gh): Target {
  const repository = repositoryName(options.repository ?? (env.GITHUB_ACTIONS === 'true' ? env.GITHUB_REPOSITORY : undefined) ?? run(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']));
  let number = options.pr === undefined ? undefined : prNumber(options.pr);
  const actions = env.GITHUB_ACTIONS === 'true';
  if (number === undefined && actions) number = eventPr(event, repository);
  if (number === undefined && actions) {
    const ref = /^refs\/pull\/(\d+)\/(?:merge|head)$/.exec(env.GITHUB_REF ?? '');
    if (ref) number = prNumber(ref[1]);
    else {
      const branch = env.GITHUB_HEAD_REF || (env.GITHUB_REF_TYPE === 'branch' ? env.GITHUB_REF_NAME : undefined) || nested(event, 'workflow_run', 'head_branch');
      if (!branch || typeof branch !== 'string') throw new Error('This Actions event does not identify a PR. Supply --pr (and --repo when needed).');
      const prs: unknown = JSON.parse(run(['pr', 'list', '--repo', repository, '--head', branch, '--state', 'open', '--json', 'number']));
      if (!Array.isArray(prs) || prs.length !== 1) throw new Error('Expected exactly one open PR for this Actions branch. Supply --pr explicitly.');
      number = prNumber(nested(prs[0], 'number'));
    }
  }
  let pr: unknown;
  // gh only auto-detects the current branch when --repo is omitted. The
  // returned URL is checked against the resolved repository immediately below.
  try { pr = JSON.parse(run(['pr', 'view', ...(number === undefined ? [] : [String(number), '--repo', repository]), '--json', 'number,url,state'])); }
  catch (error) { throw new Error(`Cannot resolve the current open PR. Use --pr and --repo if necessary. ${(error as Error).message}`); }
  const resolved = prNumber(nested(pr, 'number'));
  if (number !== undefined && resolved !== number) throw new Error('gh returned a different PR than requested.');
  if (nested(pr, 'state') !== 'OPEN') throw new Error('The target PR is not open.');
  const url = String(nested(pr, 'url'));
  const expected = `https://github.com/${repository}/pull/${resolved}`;
  if (url.toLowerCase() !== expected.toLowerCase()) throw new Error('Resolved PR URL does not match the target github.com repository.');
  return { repository, number: resolved, url };
}

export function formComment(form: TaskForm, key?: string): string {
  const marker = `<!-- github-ultimate:form:${form.id}${key ? `;submission:${submissionId(key)}` : ''} -->`;
  const body = `${marker}\n\n\`\`\`github-task\n${JSON.stringify(form, null, 2)}\n\`\`\``;
  if (body.length > 65000) throw new Error('Rendered form exceeds the GitHub comment limit. Shorten the form before publishing.');
  return body;
}

export function publishForm(input: string, options: PublishOptions, env: Environment, event: unknown, run: Gh = gh): Publication {
  // Reject invalid data before resolving context or making any GitHub request.
  const form = formFromDsl(input);
  const key = options.submissionId ?? (env.GITHUB_ACTIONS === 'true' && env.GITHUB_RUN_ID ? `run-${env.GITHUB_RUN_ID}-${form.id}` : undefined);
  const body = formComment(form, key);
  const target = resolveTarget(options, env, event, run);
  const result: Publication = { ...target, formId: form.id, body, dryRun: options.dryRun === true, reused: false };
  if (result.dryRun) return result;
  if (key) {
    const pages: unknown = JSON.parse(run(['api', `repos/${target.repository}/issues/${target.number}/comments`, '--paginate', '--slurp']));
    if (!Array.isArray(pages) || !pages.every(Array.isArray)) throw new Error('Unexpected paginated comments response from gh.');
    const marker = body.split('\n')[0];
    const matches = (pages as unknown[][]).flat().filter(comment => String(nested(comment, 'body') ?? '').split('\n')[0] === marker);
    if (matches.length > 1) throw new Error('Multiple comments already use this submission ID. Inspect them before retrying.');
    if (matches.length === 1) {
      if (nested(matches[0], 'body') !== body) throw new Error('Submission ID already exists with different form content. Use a new submission ID; existing forms are never silently edited.');
      return { ...result, ...commentResult(matches[0], target), reused: true };
    }
  }
  const comment: unknown = JSON.parse(run(['api', '--method', 'POST', `repos/${target.repository}/issues/${target.number}/comments`, '--input', '-'], JSON.stringify({ body })));
  return { ...result, ...commentResult(comment, target) };
}

function commentResult(comment: unknown, target: Target): { commentId: number; commentUrl: string } {
  const commentId = prNumber(nested(comment, 'id'));
  const commentUrl = String(nested(comment, 'html_url'));
  const expected = `${target.url}#issuecomment-${commentId}`;
  if (commentUrl.toLowerCase() !== expected.toLowerCase()) throw new Error('Unexpected comment URL returned by GitHub; inspect the PR before retrying publication.');
  return { commentId, commentUrl };
}
