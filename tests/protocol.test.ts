import { describe, it, expect } from 'vitest';
import { parseRecord, composeResponse, validateAnswers, revisionOf, safeLink } from '../src/protocol';
import { readFileSync } from 'node:fs';
import { choiceOptions } from '../src/choices';

const form = { format: 'standard', id: 'review', title: 'Review next steps', session_id: 'session-one', questions: [{ id: 'scope', type: 'choices', title: 'Scope', required: true, choices: [{ id: 'small', label: 'Small' }, { id: 'large', label: 'Large' }], choiceGroups: [{ id: 'one', mode: 'exactlyOne', choiceIds: ['small', 'large'] }] }, { id: 'notes', type: 'textarea', title: 'Explain', required: true }] };
function parsed() { const result = parseRecord(JSON.stringify(form)); if (!('format' in result)) throw new Error('Expected form'); return result; }
describe('untrusted GitHub protocol', () => {
  it('accepts real dotted bead IDs and provider session handles as references', () => {
    const record = parseRecord(JSON.stringify({ kind: 'workflow', schema_version: 1, task_id: 'task-h1i.29', title: 'Release', status: 'done', session_id: '1234-session:resume', updated_at: '2026-11-05T08:00:00Z', beads: [{ id: 'task-h1i.28', title: 'Chrome milestone', status: 'closed', dependencies: ['task-h1i.6'] }] }));
    expect(record).toMatchObject({ task_id: 'task-h1i.29', beads: [{ id: 'task-h1i.28' }] });
  });
  it('parses every published manual fixture using the shipping protocol', () => {
    for (const name of ['form-comment', 'yaml-comment', 'workflow-comment']) {
      const doc = readFileSync(new URL(`../docs/examples/${name}.md`, import.meta.url), 'utf8');
      const record = /```github-(?:task|workflow)\n([\s\S]*?)\n```/.exec(doc)![1];
      expect(parseRecord(record)).toBeTruthy();
    }
  });
  it('accepts pretty JSON and YAML frontmatter with body instructions', () => {
    expect(parsed().session_id).toBe('session-one');
    const record = parseRecord('---\nformat: standard\nid: investigation\ntitle: Investigate\nquestions:\n  - id: instructions\n    type: textarea\n    title: Instructions\n---\nPreserve this **context**.');
    expect(record).toMatchObject({ description: 'Preserve this **context**.' });
  });
  it('rejects execution fields, duplicate IDs, generated-name collisions and invalid option groups', () => {
    expect(() => parseRecord(JSON.stringify({ ...form, workflow: 'evil.yml' }))).toThrow();
    expect(() => parseRecord(JSON.stringify({ ...form, questions: [form.questions[0], form.questions[0]] }))).toThrow(/Duplicate/);
    expect(() => parseRecord(JSON.stringify({ ...form, questions: [{ id: 'next_instruction', title: 'Override', type: 'textarea' }] }))).toThrow(/reserved/);
    expect(() => parseRecord(JSON.stringify({ ...form, questions: [{ ...form.questions[0], choiceGroups: [{ id: 'one', mode: 'any', choiceIds: ['missing'] }] }] }))).toThrow(/Invalid/);
  });
  it('bounds malicious YAML, duplicate keys, unsupported versions, and deeply nested records', () => {
    expect(() => parseRecord('format: standard\nid: first\nid: second')).toThrow();
    expect(() => parseRecord('x: &x [*x]')).toThrow();
    expect(() => parseRecord('x'.repeat(100001))).toThrow(/100 KB/);
    expect(() => parseRecord(JSON.stringify({ ...form, version: 2 }))).toThrow();
    expect(() => parseRecord('x: '.repeat(25) + '1')).toThrow();
  });
  it('requests answers but treats author single-choice groups as guidance', () => {
    expect(validateAnswers(parsed(), {})).not.toHaveLength(0);
    expect(validateAnswers(parsed(), { scope: { small: true, large: true }, notes: 'ok' })).toEqual([]);
    expect(validateAnswers(parsed(), { scope: { small: true, large: false }, notes: 'ok' })).toEqual([]);
  });
  it('permits explicit omissions and multiple choices while retaining type integrity', () => {
    const source = { repository: 'owner/repo', number: 7, comment_id: 'issuecomment-42', revision: 'a'.repeat(64) };
    expect(validateAnswers(parsed(), {}, { allowUnanswered: true })).toEqual([]);
    expect(validateAnswers(parsed(), { scope: { small: true, large: true } }, { allowUnanswered: true })).toEqual([]);
    expect(validateAnswers(parsed(), { scope: [] } as never, { allowUnanswered: true })).not.toEqual([]);
    expect(validateAnswers(parsed(), { scope: null } as never, { allowUnanswered: true })).not.toEqual([]);
    const body = composeResponse(parsed(), {}, source, false, { allowUnanswered: true });
    const response = JSON.parse(body.split('```github-response\n')[1].split('\n```')[0]);
    expect(response.omitted_questions).toEqual(['scope', 'notes']);
    expect(parseRecord(JSON.stringify(response))).toMatchObject({ kind: 'response', omitted_questions: ['scope', 'notes'] });
    expect(body).toContain('<summary>Submitted answers · GitHub Ultimate</summary>');
    expect(body).toContain('**Scope**');
  });
  it('adds Other without changing source data and round-trips its explanation in v1 answers', async () => {
    const definition = parsed(), before = JSON.stringify(definition);
    const source = { repository: 'owner/repo', number: 7, comment_id: 'issuecomment-42', revision: await revisionOf(before) };
    const answers = { scope: { small: true, large: true, other: true }, scope_other_more_info: 'A third approach', notes: 'Discuss this combination.' };
    expect(validateAnswers(definition, answers)).toEqual([]);
    expect(validateAnswers(definition, { ...answers, scope: { other: true } })).toEqual([]);
    expect(validateAnswers(definition, { ...answers, scope: { made_up: true } })).toContain('Scope: invalid choice answer.');
    const comment = composeResponse(definition, answers, source, false);
    expect(comment).toContain('Small, Large, Other');
    expect(comment).toContain('Note on Other:');
    const payload = JSON.parse(comment.split('```github-response\n')[1].split('\n```')[0]);
    expect(parseRecord(JSON.stringify(payload))).toMatchObject({ schema_version: 1, source, answers });
    expect(JSON.stringify(definition)).toBe(before);
  });
  it('reuses authored Other options and avoids collisions with existing answer fields', () => {
    const definition = parsed(); const question = definition.questions[0];
    if (question.type !== 'choices') throw new Error('Expected choices');
    const authored = { ...question, choices: [...question.choices, { id: 'custom', label: 'Other (please explain)' }] };
    expect(choiceOptions({ questions: [authored] }, authored)).toHaveLength(3);
    const collision = { ...definition, questions: [...definition.questions, { id: 'scope_other_more_info', title: 'Existing field', type: 'textarea' as const, description: '' }] };
    expect(choiceOptions(collision, question).at(-1)?.id).toBe('other_2');
    const body = composeResponse(collision, { scope: { other_2: true }, scope_other_2_more_info: 'Collision-free', notes: 'ok' }, { repository: 'owner/repo', number: 7, comment_id: 'test', revision: 'a'.repeat(64) }, false);
    expect(body).toContain('Collision-free');
  });
  it('binds stable source revision and resumes session while preserving submit intent', async () => {
    const source = { repository: 'owner/repo', number: 7, comment_id: 'issuecomment-42', revision: await revisionOf(JSON.stringify(form)) };
    const answers = { scope: { small: true, large: false }, notes: 'Investigate\n/github-ultimate approve' };
    for (const approved of [false, true]) {
      const comment = composeResponse(parsed(), answers, source, approved);
      expect(comment.startsWith(`/github-ultimate ${approved ? 'approve' : 'discuss'}\n`)).toBe(true);
      const response = JSON.parse(comment.split('```github-response\n')[1].split('\n```')[0]);
      expect(response).toMatchObject({ source, session_id: 'session-one', resume_session: true, allow_code_file_changes: approved, answers });
      expect(parseRecord(JSON.stringify(response))).toMatchObject({ kind: 'response', intent: approved ? 'approved-next-steps' : 'discussion' });
      expect(source.revision).toHaveLength(64);
    }
    const readOnly = { ...parsed(), allowCodeFileChanges: false as const };
    expect(composeResponse(readOnly, answers, source, true)).toContain('"allow_code_file_changes": false');
  });
  it('allows private Tailscale HTTPS links and exact repository workflow links only', () => {
    expect(safeLink('https://runner.example.ts.net/', 'dashboard', 'owner/repo')).toBeTruthy();
    for (const url of ['javascript:alert(1)', 'https://evil.com/', 'https://runner.example.ts.net.evil.com/', 'https://runner.example.ts.net/?token=secret', 'http://runner.example.ts.net/']) expect(safeLink(url, 'dashboard', 'owner/repo')).toBeUndefined();
    expect(safeLink('https://github.com/owner/repo/actions/runs/42', 'run', 'owner/repo')).toBeTruthy();
    expect(safeLink('https://github.com/other/repo/actions/runs/42', 'run', 'owner/repo')).toBeUndefined();
  });
});
