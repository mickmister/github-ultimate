import { readFileSync, appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { publishForm, prNumber, formComment, formFromDsl, type PublishOptions } from './publish-form.ts';

const help = `Publish a GitHub Ultimate form using gh.

Usage:
  github-ultimate-form form.json
  github-ultimate-form --file form.yaml
  github-ultimate-form < form.json
  pnpm run form --file form.json

Options:
  --file <path>          Read JSON/YAML DSL or a single fenced example (- = stdin)
  --repo <owner/repo>    Override repository (default: gh/current Actions repo)
  --pr <number>         Override PR (default: current branch/Actions event)
  --submission-id <id>  Reuse exact existing comment on retry; never silently edit
  --dry-run             Resolve target and preview without posting
  --print               Validate/print Markdown only; no gh or authentication needed
  --json                Print machine-readable result
  --github-output       Also append outputs to the Actions GITHUB_OUTPUT file
  --help                Show this help

Actions: detects pull_request, issue_comment on a PR, workflow_run, refs/pull,
or a branch with exactly one open PR. Uses GH_TOKEN/GITHUB_TOKEN through gh.
Actions retries default to submission ID run-<GITHUB_RUN_ID>-<form.id>.
`;

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    file: { type: 'string' }, repo: { type: 'string' }, pr: { type: 'string' },
    'submission-id': { type: 'string' }, 'dry-run': { type: 'boolean' }, print: { type: 'boolean' }, json: { type: 'boolean' }, 'github-output': { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) { console.log(help); }
  else {
    if (positionals.length > 1 || (positionals.length && values.file)) throw new Error('Supply one file path, --file, or stdin.');
    if (values.print && (values['dry-run'] || values['github-output'])) throw new Error('--print cannot be combined with --dry-run or --github-output.');
    const file = values.file ?? positionals[0] ?? '-';
    if (file === '-' && process.stdin.isTTY) throw new Error('Provide a form file or pipe form DSL into stdin. Use --help for examples.');
    const input = readFileSync(file === '-' ? 0 : file, 'utf8');
    if (values.print) {
      const form = formFromDsl(input); const body = formComment(form, values['submission-id']);
      console.log(values.json ? JSON.stringify({ formId: form.id, body }, null, 2) : body);
    } else {
      const options: PublishOptions = { repository: values.repo, pr: values.pr === undefined ? undefined : prNumber(values.pr), submissionId: values['submission-id'], dryRun: values['dry-run'] };
      if (values['github-output'] && !process.env.GITHUB_OUTPUT) throw new Error('--github-output requires GITHUB_OUTPUT.');
      let event: unknown;
      if (process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_EVENT_PATH && options.pr === undefined) {
        const raw = readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8');
        if (raw.length > 5 * 1024 * 1024) throw new Error('Actions event payload exceeds 5 MB. Supply --pr explicitly.');
        event = JSON.parse(raw);
      }
      // gh supports GH_TOKEN or GITHUB_TOKEN directly. Never print their values.
      const result = publishForm(input, options, process.env, event);
      if (values['github-output']) appendFileSync(process.env.GITHUB_OUTPUT!, [
        `repository=${result.repository}`, `pr-number=${result.number}`, `pr-url=${result.url}`,
        `form-id=${result.formId}`, `comment-id=${result.commentId ?? ''}`, `comment-url=${result.commentUrl ?? ''}`, `reused=${result.reused}`,
      ].join('\n') + '\n');
      if (values.json) console.log(JSON.stringify(result, null, 2));
      else if (result.dryRun) console.log(`Target: ${result.url}\nDry run — no comment posted.\n\n${result.body}`);
      else console.log(`${result.reused ? 'Existing form' : 'Posted form'}: ${result.commentUrl}`);
    }
  }
} catch (error) {
  console.error(`github-ultimate-form: ${(error as Error).message}`);
  process.exitCode = 1;
}
