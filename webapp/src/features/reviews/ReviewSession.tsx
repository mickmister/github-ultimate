import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import type { OpenReview } from '../../../../hosted/reviews';
import { validateReviewArtifact, type ReviewArtifact } from '../../../../src/review-protocol';
import type { Answers } from '../../../../src/protocol';
import type { WorkspaceScope } from '../../app-hooks/contracts';
import type { ReviewListing, ReviewsModuleV1 } from '../../app-hooks/reviews';
import { createFeedbackQueue } from '../feedback/queue';
import { FeedbackProvider } from '../feedback/FeedbackProvider';
import { restoreReviewComments, responsesFor, storeReviewComments } from './model';
import { ReviewSessionView } from './ReviewSession.view';

export function ReviewSession({ scope, review, listing, service, refresh, updateListing }: {
  scope: WorkspaceScope; review: OpenReview; listing: ReviewListing; service: ReviewsModuleV1; refresh(): void; updateListing: Dispatch<SetStateAction<ReviewListing | null>>;
}) {
  const initial = useMemo(() => listing.artifacts.find(item => item.value.kind === 'review-draft' && item.value.reviewer === listing.reviewer && item.value.request.id === review.request.request_id && item.value.request.version === review.pin.version), []);
  const [queue] = useState(() => createFeedbackQueue(restoreReviewComments(scope, review, initial?.value.comments ?? [])));
  const comments = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const [forms, setForms] = useState<ReviewArtifact['forms']>(initial?.value.forms ?? []);
  const [progress, setProgress] = useState(initial?.value.progress ?? []);
  const [selected, setSelected] = useState(review.request.members[0].id);
  const [draftVersion, setDraftVersion] = useState<string | null>(initial?.pin.version ?? null);
  const [draftId] = useState(initial?.value.id ?? `draft-${crypto.randomUUID()}`);
  const [saved, setSaved] = useState('');
  const [notice, setNotice] = useState(initial ? 'Remote draft restored.' : 'Changes are unsaved until you save a draft or submit.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<{ fingerprint: string; value: ReviewArtifact } | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const responses = responsesFor(review, listing.artifacts);
  const submitted = new Set(responses.flatMap(item => item.value.forms.map(form => form.member_id)));
  const body = {
    schema_version: 1 as const, transport: 'workspace-resources' as const,
    request: { id: review.request.request_id, version: review.pin.version, snapshot: review.pin.snapshot },
    reviewer: listing.reviewer, forms, progress, comments: storeReviewComments(scope, review, comments.items),
  };
  const fingerprint = JSON.stringify(body);
  const initialFingerprint = useRef(fingerprint);
  const dirty = (saved || initialFingerprint.current) !== fingerprint;
  function answer(memberId: string, answers: Answers, intent: 'discussion' | 'approved-next-steps') {
    const member = review.request.members.find(member => member.id === memberId);
    if (member?.kind !== 'form') return;
    setForms(current => [...current.filter(form => form.member_id !== memberId), { member_id: member.id, bead_id: member.bead_id, form_id: member.form_id, dsl: member.dsl, answers, intent }]);
  }
  async function save(submit: boolean, memberId?: string) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const submittedComments = new Set(responses.flatMap(item => item.value.comments.map(comment => `${comment.id}:${comment.version ?? 1}`)));
      const content = submit ? { ...body, forms: body.forms.filter(form => !submitted.has(form.member_id) && (!memberId || form.member_id === memberId)), comments: body.comments.filter(comment => (!memberId || comment.member_id === memberId) && !submittedComments.has(`${comment.id}:${comment.version ?? 1}`)) } : body;
      if (submit && memberId && !content.forms.length && !submitted.has(memberId)) {
        const member = review.request.members.find(member => member.id === memberId);
        if (member?.kind === 'form') content.forms.push({ member_id: member.id, bead_id: member.bead_id, form_id: member.form_id, dsl: member.dsl, answers: {}, intent: 'discussion' });
      }
      if (submit && responses.length && !content.forms.length && !content.comments.length && responses.some(item => JSON.stringify(item.value.progress) === JSON.stringify(content.progress))) {
        setNotice('This feedback already has a saved response receipt.'); return;
      }
      const identity = JSON.stringify({ submit, memberId, ...content });
      if (pending.current?.fingerprint !== identity) pending.current = { fingerprint: identity, value: submit
        ? { ...content, kind: 'review-response', intent: 'feedback', id: `response-${crypto.randomUUID()}` }
        : { ...content, kind: 'review-draft', id: draftId } };
      const value = pending.current.value;
      if (memberId && !value.forms.length) throw new Error('Enter an answer before submitting this form.');
      await validateReviewArtifact(review.request, value, pin => service.read(scope, pin));
      const receipt = await service.save(scope, value, submit ? null : draftVersion);
      if (!mounted.current) return;
      updateListing(current => current ? { ...current, artifacts: [...current.artifacts.filter(item => item.pin.resource !== receipt.resource), { value, pin: { resource: receipt.resource, version_kind: 'git-blob', version: receipt.version, snapshot: receipt.snapshot } }] } : current);
      if (!submit) { setDraftVersion(receipt.version); setSaved(fingerprint); }
      setNotice(submit ? 'Response saved remotely. Task notification is pending the agent intake receipt.' : 'Draft saved remotely. You can reopen this revision on another device.');
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (mounted.current) setBusy(false); }
  }
  const latest = listing.requests.find(item => item.request.request_id === review.request.request_id);
  return <FeedbackProvider queue={queue} storageKey={`review:${scope.repository}:${scope.workspace}:${review.request.request_id}:${review.pin.version}`}>
    <ReviewSessionView scope={scope} review={review} listing={listing} latest={latest} service={service} selected={selected} forms={forms} progress={progress}
      responses={responses} submitted={submitted} busy={busy} dirty={dirty} notice={notice} error={error}
      actions={{ select: setSelected, answer, progress(id, checked) { setProgress(current => checked ? [...new Set([...current, id])] : current.filter(item => item !== id)); }, saveDraft: () => void save(false), submit: id => void save(true, id), refresh }} />
  </FeedbackProvider>;
}
