import type { AppHooksV1, WorkspaceScope } from '../src/app-hooks/contracts';
import type { ReviewListing } from '../src/app-hooks/reviews';
import { artifactResource, validateReviewArtifact, type ReviewPin, type ReviewRequest } from '../../src/review-protocol';
import type { OpenReview } from '../../hosted/reviews';

export const reviewScope: WorkspaceScope = { connectionId: 'a6075abf-226e-4c88-977c-e11404e59f32', installationId: 1, repository: 'example/storage', workspace: 'reader-workspace' };
const pin = (resource: string, letter: string): ReviewPin => ({ resource, version_kind: 'git-blob', version: letter.repeat(40), snapshot: '1'.repeat(40) });
const target = pin('threads/task-reader/plan.md', 'a'), baseline = pin('threads/task-reader/plan.md', 'b');
const formPin = pin('forms/reader.json', 'c'), secondPin = pin('forms/review.json', 'd');
const text = '# Reader plan\n\nThe full target document is pinned to this packet.\n\n## Changes\n\nRemote drafts survive reopening.\n';
const before = '# Reader plan\n\nThe baseline had browser-only drafts.\n';
const form = (id: string, title: string) => JSON.stringify({ format: 'standard', id, task_id: 'task-reader', title, goal: 'Choose the next steps for this implementation.', questions: [{ id: 'decision', type: 'choices', title: 'Next steps', description: 'The author suggests selecting one option. You can choose multiple.', choices: [{ id: 'keep', label: 'Keep this approach', description: 'Continue with the implementation shown in the pinned document.' }, { id: 'revise', label: 'Revise this approach', description: 'Use your notes to describe the changes you want.' }], choiceGroups: [{ id: 'suggested-choice', title: 'Single select question', mode: 'exactlyOne', choiceIds: ['keep', 'revise'] }] }, { id: 'additional_notes', type: 'textarea', title: 'Additional notes' }] });
const documents = new Map([[target.version, text], [baseline.version, before], [formPin.version, form('reader_decisions', 'Reader decisions')], [secondPin.version, form('review_feedback', 'Review experience feedback')]]);
export interface ReviewFixtureState { artifacts: ReviewListing['artifacts']; revision: number; failSecond?: boolean; missingBaseline?: boolean }
export interface ReviewComparisonFixture { path: string; before: string; after: string }
export const richComparison: ReviewComparisonFixture = {
  path: 'threads/task-reader/plan.md',
  before: '# Reader plan\n\nKeep **local drafts** in this [workspace][guide].\n\n## Next steps\n\n- Save in the browser\n- Reopen this tab\n\n| Storage | Lifetime |\n| --- | --- |\n| Local | One tab |\n\n> This warning was removed.\n\n```ts\nconst storage = "local";\n```\n\n```mermaid\nflowchart LR\n  Draft --> Review\n```\n\n[guide]: https://example.com/guide\n',
  after: '# Reader plan\n\nKeep **remote drafts** in this [workspace][guide].\n\n## Next steps\n\n- Save remotely\n- Reopen any tab\n\n| Storage | Lifetime |\n| --- | --- |\n| Remote | Persistent |\n\n```ts\nconst storage = "remote";\n```\n\n## Added section\n\nRead the *updated* guidance. [Unsafe](javascript:alert(1))\n\n<script>window.markdownDiffInjected = true</script>\n\n```mermaid\nflowchart LR\n  Draft --> Review\n```\n\n[guide]: https://example.com/guide\n',
};
export function createReviewFixture({ remote = false, missingBaseline = false, comparison, process = false }: { remote?: boolean; missingBaseline?: boolean; comparison?: ReviewComparisonFixture; process?: boolean } = {}): AppHooksV1 {
  let state: ReviewFixtureState = { artifacts: [], revision: 1, missingBaseline };
  const load = async (resource?: ReviewPin) => remote ? await (await fetch('/__review-fixture', { headers: resource ? { 'X-Review-Resource': JSON.stringify(resource) } : undefined })).json() as ReviewFixtureState : state;
  const store = async (next: ReviewFixtureState) => { if (remote) await fetch('/__review-fixture', { method: 'POST', body: JSON.stringify(next) }); else state = next; };
  function packet(id: string, revision: number): OpenReview {
    const request: ReviewRequest = { kind: 'review-request', schema_version: 1, request_id: id, revision_id: `revision-${revision}`, workspace: reviewScope.workspace, bead_id: 'task-reader', related_beads: [], thread: 'threads/task-reader', title: id === 'reader-01' ? 'Reader follow-up' : 'Independent reader review', purpose: 'Review the pinned reader plan and two forms.', question: revision === 1 ? 'What should we do next?' : 'Updated question: which changes should we make?', status: 'published', change_kind: 'implemented', members: [
      { id: 'plan', kind: 'document', label: 'Reader plan', target: { ...target, resource: comparison?.path ?? target.resource }, baseline: { ...baseline, resource: comparison?.path ?? baseline.resource } },
      { id: 'reader', kind: 'form', label: 'Reader decisions', bead_id: 'task-reader', form_id: 'reader_decisions', dsl: formPin },
      { id: 'experience', kind: 'form', label: 'Review experience', bead_id: 'task-reader', form_id: 'review_feedback', dsl: secondPin },
    ] };
    if (process) request.process = { kind: 'qrspi', id: 'hosted-pilot', workspace_ref: 'nugs://workspace/reader-workspace', thread_id: request.thread, config: pin('threads/task-reader/config.md', '9') };
    return { request, pin: { resource: `review-requests/${id}/request.json`, version_kind: 'git-blob', version: (revision === 1 ? 'e' : 'f').repeat(40), snapshot: '1'.repeat(40) } };
  }
  const read = async (_scope: WorkspaceScope, pin: ReviewPin) => {
    if (pin.resource.endsWith('/config.md')) return '---\npipeline: full\nroute: [goals, questions, research, design, plan, implement]\n---\n';
    if ((await load(pin)).missingBaseline && pin.version === baseline.version) throw new Error('Historical baseline is unavailable.');
    if (comparison && pin.version === target.version) return comparison.after;
    if (comparison && pin.version === baseline.version) return comparison.before;
    const text = documents.get(pin.version);
    if (text === undefined) throw new Error('Pinned resource unavailable.');
    return text;
  };
  return { contractVersion: 1, modules: {
    documents: { version: 1, connect: async () => [{ id: reviewScope.connectionId, name: 'Fixture reviewer', installationId: 1, account: 'example' }], discover: async () => [{ id: reviewScope.workspace, hasDocuments: true }], open: async () => { throw new Error('Use review fixture transport.'); }, read: async () => '', dispose() {} },
    reviews: {
      async list() { const current = await load(); return { requests: [packet('reader-01', current.revision), packet('reader-02', 1)], artifacts: current.artifacts, reviewer: 'github:1', acknowledgements: [] }; },
      async open(_scope, pin) { return packet(pin.resource.split('/')[1], pin.version === 'f'.repeat(40) ? 2 : 1); }, read,
      async current(_scope, resource) { return resource.endsWith('/config.md') ? { pin: pin(resource, '9'), text: '---\npipeline: full\nroute: [goals, questions, research, design, plan, implement]\n---\n' } : { pin: pin(resource, '8'), text: '---\nstatus: draft\nphase: design\n---\n' }; },
      async save(scope, value, expected) {
        const current = await load();
        if (current.failSecond && value.kind === 'review-response' && value.forms.some(form => form.member_id === 'experience')) throw new Error('Second form transport unavailable. Your first form receipt is retained.');
        const request = packet(value.request.id, value.request.version === 'f'.repeat(40) ? 2 : 1).request;
        await validateReviewArtifact(request, value, pin => read(scope, pin));
        const resource = artifactResource(value);
        const existing = current.artifacts.find(item => item.pin.resource === resource);
        if (existing && JSON.stringify(existing.value) === JSON.stringify(value)) return { ...existing.pin, reviewer: value.reviewer, ...(process ? { dispatch: { state: 'dispatched' as const, message: 'Dispatch accepted; start unknown.' } } : {}) };
        if ((existing?.pin.version ?? null) !== expected) throw new Error('Review save conflict. Reload the remote draft.');
        const version = [...new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(JSON.stringify(value))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        const saved = { value, pin: { resource, version_kind: 'git-blob' as const, version, snapshot: '2'.repeat(40) } };
        await store({ ...current, artifacts: [...current.artifacts.filter(item => item.pin.resource !== resource), saved] });
        return { ...saved.pin, reviewer: value.reviewer, ...(process && value.kind === 'review-response' ? { dispatch: { state: 'failed' as const, message: 'Missing installed-source Actions write route. Response is saved.' } } : {}) };
      },
    },
  } };
}
