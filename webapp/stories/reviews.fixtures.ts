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
export function createReviewFixture({ remote = false, missingBaseline = false } = {}): AppHooksV1 {
  let state: ReviewFixtureState = { artifacts: [], revision: 1, missingBaseline };
  const load = async () => remote ? await (await fetch('/__review-fixture')).json() as ReviewFixtureState : state;
  const store = async (next: ReviewFixtureState) => { if (remote) await fetch('/__review-fixture', { method: 'POST', body: JSON.stringify(next) }); else state = next; };
  function packet(id: string, revision: number): OpenReview {
    const request: ReviewRequest = { kind: 'review-request', schema_version: 1, request_id: id, revision_id: `revision-${revision}`, workspace: reviewScope.workspace, bead_id: 'task-reader', related_beads: [], thread: 'threads/task-reader', title: id === 'reader-01' ? 'Reader follow-up' : 'Independent reader review', purpose: 'Review the pinned reader plan and two forms.', question: revision === 1 ? 'What should we do next?' : 'Updated question: which changes should we make?', status: 'published', change_kind: 'implemented', members: [
      { id: 'plan', kind: 'document', label: 'Reader plan', target, baseline },
      { id: 'reader', kind: 'form', label: 'Reader decisions', bead_id: 'task-reader', form_id: 'reader_decisions', dsl: formPin },
      { id: 'experience', kind: 'form', label: 'Review experience', bead_id: 'task-reader', form_id: 'review_feedback', dsl: secondPin },
    ] };
    return { request, pin: { resource: `review-requests/${id}/request.json`, version_kind: 'git-blob', version: (revision === 1 ? 'e' : 'f').repeat(40), snapshot: '1'.repeat(40) } };
  }
  const read = async (_scope: WorkspaceScope, pin: ReviewPin) => {
    if ((await load()).missingBaseline && pin.version === baseline.version) throw new Error('Historical baseline is unavailable.');
    const text = documents.get(pin.version);
    if (text === undefined) throw new Error('Pinned resource unavailable.');
    return text;
  };
  return { contractVersion: 1, modules: {
    documents: { version: 1, connect: async () => [{ id: reviewScope.connectionId, name: 'Fixture reviewer', installationId: 1, account: 'example' }], discover: async () => [{ id: reviewScope.workspace, hasDocuments: true }], open: async () => { throw new Error('Use review fixture transport.'); }, read: async () => '', dispose() {} },
    reviews: {
      async list() { const current = await load(); return { requests: [packet('reader-01', current.revision), packet('reader-02', 1)], artifacts: current.artifacts, reviewer: 'github:1', acknowledgements: [] }; },
      async open(_scope, pin) { return packet(pin.resource.split('/')[1], pin.version === 'f'.repeat(40) ? 2 : 1); }, read,
      async save(scope, value, expected) {
        const current = await load();
        if (current.failSecond && value.kind === 'review-response' && value.forms.some(form => form.member_id === 'experience')) throw new Error('Second form transport unavailable. Your first form receipt is retained.');
        const request = packet(value.request.id, value.request.version === 'f'.repeat(40) ? 2 : 1).request;
        await validateReviewArtifact(request, value, pin => read(scope, pin));
        const resource = artifactResource(value);
        const existing = current.artifacts.find(item => item.pin.resource === resource);
        if (existing && JSON.stringify(existing.value) === JSON.stringify(value)) return { ...existing.pin, reviewer: value.reviewer };
        if ((existing?.pin.version ?? null) !== expected) throw new Error('Review save conflict. Reload the remote draft.');
        const version = [...new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(JSON.stringify(value))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        const saved = { value, pin: { resource, version_kind: 'git-blob' as const, version, snapshot: '2'.repeat(40) } };
        await store({ ...current, artifacts: [...current.artifacts.filter(item => item.pin.resource !== resource), saved] });
        return { ...saved.pin, reviewer: value.reviewer };
      },
    },
  } };
}
