import { describe, it, expect, vi } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { eventPr, formComment, formFromDsl, publishForm, resolveTarget, type Gh } from '../cli/publish-form';

const input = JSON.stringify({ format: 'standard', id: 'cli_form', title: 'Choose next steps', questions: [{ type: 'textarea', id: 'notes', title: 'Notes' }] });
const target = { repository: 'owner/repo', number: 2, url: 'https://github.com/owner/repo/pull/2' };
const comment = { id: 123, html_url: `${target.url}#issuecomment-123` };
function mockGh(pages: unknown = []) {
  return vi.fn<Gh>((args, stdin) => {
    if (args[0] === 'repo') return 'owner/repo';
    if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify({ ...target, state: 'OPEN' });
    if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify([{ number: 2 }]);
    if (args[0] === 'api' && args.includes('--paginate')) return JSON.stringify(pages);
    if (args[0] === 'api' && args.includes('POST')) { expect(JSON.parse(stdin!).body).toContain('```github-task\n'); return JSON.stringify(comment); }
    throw new Error(`Unexpected command ${args.join(' ')}`);
  });
}
describe('gh-backed form publisher', () => {
  it('discovers repository/current branch PR and posts normalized DSL through gh stdin', () => {
    const gh = mockGh(); const result = publishForm(input, {}, {}, undefined, gh);
    expect(result).toMatchObject({ ...target, formId: 'cli_form', commentId: 123, commentUrl: comment.html_url, reused: false });
    expect(gh).toHaveBeenCalledWith(['pr', 'view', '--json', 'number,url,state']);
    const post = gh.mock.calls.find(([args]) => args.includes('POST'))!;
    expect(post[0]).toEqual(['api', '--method', 'POST', 'repos/owner/repo/issues/2/comments', '--input', '-']);
    expect(JSON.parse(post[1]!).body).toContain('"version": 1');
    expect(JSON.parse(post[1]!).body).toContain('<summary>Form: Choose next steps</summary>');
    expect(JSON.parse(post[1]!).body).toContain('#### 1. Notes');
  });
  it('fails invalid DSL before any GitHub call, and rejects nonform records', () => {
    const gh = mockGh();
    expect(() => publishForm('{"format":"standard"}', {}, {}, undefined, gh)).toThrow();
    expect(gh).not.toHaveBeenCalled();
    expect(() => formFromDsl(JSON.stringify({ kind: 'workflow', schema_version: 1, task_id: 'x', title: 'x', status: 'done', updated_at: '2026-11-05T00:00:00Z' }))).toThrow(/Expected standard form/);
  });
  it('accepts YAML/frontmatter and exactly one complete fenced example', () => {
    const example = readFileSync(new URL('../docs/examples/yaml-comment.md', import.meta.url), 'utf8');
    expect(formFromDsl(example).id).toBe('followup_form');
    expect(() => formFromDsl(example + '\n' + example)).toThrow(/one form/);
    expect(formFromDsl('---\nformat: standard\nid: yaml\ntitle: YAML\nquestions:\n - type: textarea\n   id: question\n   title: Question\n---\nBody context.').description).toBe('Body context.');
  });
  it('dry-runs target resolution without publishing or listing comments', () => {
    const gh = mockGh(); const result = publishForm(input, { dryRun: true, submissionId: 'retry-one' }, {}, undefined, gh);
    expect(result.dryRun).toBe(true); expect(result.body).toContain('submission:retry-one');
    expect(gh.mock.calls.some(([args]) => args[0] === 'api')).toBe(false);
  });
  it('uses PR event context rather than detached checkout branch', () => {
    const gh = mockGh(); const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'owner/repo', GITHUB_RUN_ID: '42' };
    const result = publishForm(input, {}, env, { repository: { full_name: 'owner/repo' }, number: 2, pull_request: {} }, gh);
    expect(gh).toHaveBeenCalledWith(['pr', 'view', '2', '--repo', 'owner/repo', '--json', 'number,url,state']);
    expect(result.body).toContain('submission:run-42-cli_form');
    expect(gh.mock.calls.some(([args]) => args[0] === 'repo')).toBe(false);
  });
  it('supports issue_comment PRs, workflow_run and refs/pull but never silently treats an issue as a PR', () => {
    expect(eventPr({ issue: { number: 2, pull_request: { url: 'example' } } }, 'owner/repo')).toBe(2);
    expect(eventPr({ workflow_run: { pull_requests: [{ number: 2 }] } }, 'owner/repo')).toBe(2);
    expect(() => eventPr({ issue: { number: 2 } }, 'owner/repo')).toThrow(/issue, not a PR/);
    expect(() => eventPr({ workflow_run: { pull_requests: [{ number: 2 }, { number: 3 }] } }, 'owner/repo')).toThrow(/multiple/);
    expect(resolveTarget({}, { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'owner/repo', GITHUB_REF: 'refs/pull/2/merge' }, undefined, mockGh()).number).toBe(2);
  });
  it('resolves dispatch/push branches only when exactly one PR exists', () => {
    const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'owner/repo', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'feature' };
    const gh = mockGh(); expect(resolveTarget({}, env, undefined, gh).number).toBe(2);
    expect(gh).toHaveBeenCalledWith(['pr', 'list', '--repo', 'owner/repo', '--head', 'feature', '--state', 'open', '--json', 'number']);
    for (const prs of [[], [{ number: 2 }, { number: 3 }]]) {
      const noUnique: Gh = args => args[1] === 'list' ? JSON.stringify(prs) : gh(args);
      expect(() => resolveTarget({}, env, undefined, noUnique)).toThrow(/exactly one/);
    }
    expect(() => resolveTarget({}, { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'owner/repo' }, {}, gh)).toThrow(/does not identify/);
  });
  it('allows explicit overrides while rejecting unsafe repository IDs and mismatched event targets', () => {
    const gh = mockGh();
    expect(resolveTarget({ repository: 'owner/repo', pr: 2 }, { GITHUB_ACTIONS: 'true' }, { repository: { full_name: 'other/repo' } }, gh)).toEqual(target);
    expect(() => resolveTarget({ repository: '../repo', pr: 2 }, {}, undefined, gh)).toThrow(/owner\/repo/);
    expect(() => resolveTarget({}, { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'owner/repo' }, { repository: { full_name: 'other/repo' }, number: 2, pull_request: {} }, gh)).toThrow(/differs/);
  });
  it('refuses closed PRs and unexpected target URLs', () => {
    for (const response of [{ ...target, state: 'CLOSED' }, { ...target, state: 'OPEN', url: 'https://github.com/other/repo/pull/2' }]) {
      const gh: Gh = () => JSON.stringify(response);
      expect(() => resolveTarget({ repository: 'owner/repo', pr: 2 }, {}, undefined, gh)).toThrow();
    }
  });
  it('reuses exact submissions on retry without editing existing revision-bound forms', () => {
    const body = formComment(formFromDsl(input), 'stable-one');
    const gh = mockGh([[{ ...comment, body }]]);
    expect(publishForm(input, { submissionId: 'stable-one' }, {}, undefined, gh)).toMatchObject({ commentId: 123, reused: true });
    expect(gh.mock.calls.some(([args]) => args.includes('POST'))).toBe(false);
    const changed = input.replace('Choose next steps', 'Changed title');
    expect(() => publishForm(changed, { submissionId: 'stable-one' }, {}, undefined, gh)).toThrow(/different form content/);
    expect(() => publishForm(input, { submissionId: 'stable-one' }, {}, undefined, mockGh([[{ ...comment, body }, { ...comment, body }]]))).toThrow(/Multiple comments/);
  });
  it('bounds comment size and keeps shell-like content as JSON data', () => {
    const form = formFromDsl(input); form.description = '$(touch /tmp/never) `shell`';
    expect(formComment(form)).toContain('$(touch /tmp/never)');
    form.description = 'x'.repeat(65000); expect(() => formComment(form)).toThrow(/comment limit/);
  });
  it('offers a real stdin/print executable path without gh authentication', () => {
    const output = execFileSync(process.execPath, ['--experimental-strip-types', 'cli/form.ts', '--print', '--json'], { input, encoding: 'utf8', env: { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '' } });
    expect(JSON.parse(output)).toMatchObject({ formId: 'cli_form' });
    const invalid = spawnSync(process.execPath, ['--experimental-strip-types', 'cli/form.ts', '--print'], { input: 'invalid', encoding: 'utf8' });
    expect(invalid.status).toBe(1); expect(invalid.stderr).toContain('github-ultimate-form:');
    const binary = execFileSync(process.execPath, ['bin/github-ultimate-form', '--print', '--json'], { input, encoding: 'utf8' });
    expect(JSON.parse(binary)).toMatchObject({ formId: 'cli_form' });
  });
  it('provides the same operation as a composite action with declared outputs', () => {
    const action = parse(readFileSync(new URL('../.github/actions/post-form/action.yml', import.meta.url), 'utf8'));
    expect(action.runs.using).toBe('composite');
    expect(action.inputs['form-file'].required).toBe(true);
    expect(action.outputs['comment-url']).toBeDefined();
    expect(action.runs.steps.at(-1).run).toContain('--github-output');
  });
});
