import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import type { OpenReview } from '../../../../hosted/reviews';
import { validateReviewArtifact, type ReviewArtifact } from '../../../../src/review-protocol';
import type { Answers } from '../../../../src/protocol';
import type { WorkspaceScope } from '../../app-hooks/contracts';
import type { ReviewListing, ReviewsModuleV1 } from '../../app-hooks/reviews';
import { createFeedbackQueue, restoreFeedbackDraft } from '../feedback/queue';
import { restoreReviewComments, responsesFor, storeReviewComments } from './model';
import { readRecovery, recoveryKey, writeRecovery, recoveryFingerprint } from './recovery';
import type { createReviewContents, ReviewContents } from './review-contents';
import type { ReviewDocumentZen } from './ReviewPacket.hooks';
import { reviewsCopy as copy } from './Reviews.copy';

export function useReviewSessionFeature({ scope, review, listing, service, refresh, updateListing, contentsCache, contents, initialSelected, documentZen }: {
  scope: WorkspaceScope; review: OpenReview; listing: ReviewListing; service: ReviewsModuleV1; refresh(): void; updateListing: Dispatch<SetStateAction<ReviewListing | null>>;
  contentsCache: ReturnType<typeof createReviewContents>; contents: ReviewContents; initialSelected: string;
  documentZen: ReviewDocumentZen;
}) {
  const initial = useMemo(() => listing.artifacts.find(item => item.value.kind === 'review-draft' && item.value.reviewer === listing.reviewer && item.value.request.id === review.request.request_id && item.value.request.version === review.pin.version && item.value.request.snapshot === review.pin.snapshot), []);
  const key = recoveryKey(scope, review, listing.reviewer);
  const [recovery] = useState(() => readRecovery(key, listing.reviewer, { id: review.request.request_id, version: review.pin.version, snapshot: review.pin.snapshot }));
  const recoveredPending = useRef(recovery?.pending ?? null);
  const [queue] = useState(() => {
    const commentKey = `review-comment-recovery:${key}`;
    const intakeKey = `review-feature-intake:${scope.repository}:${scope.workspace}:${listing.reviewer}`;
    let features = [] as ReturnType<typeof restoreFeedbackDraft>;
    try { features = restoreFeedbackDraft(sessionStorage.getItem(intakeKey)).filter(item => item.kind === 'feature-comment'); } catch { /* Tab storage unavailable. */ }
    const remote = restoreReviewComments(scope, review, initial?.value.comments ?? []);
    let restored = remote.filter(item => item.kind === 'content-comment');
    try {
      const local = localStorage.getItem(commentKey);
      if (local !== null) restored = restoreFeedbackDraft(local).filter(item => item.kind === 'content-comment');
    } catch { /* Use the remote draft when local storage is unavailable. */ }
    const intake = [...remote.filter(item => item.kind === 'feature-comment' && !features.some(local => local.id === item.id)), ...features];
    if (intake.length) try { sessionStorage.setItem(intakeKey, JSON.stringify({ schemaVersion: 1, interactions: intake })); } catch { /* Keep the restored intake in memory. */ }
    return createFeedbackQueue([...restored.filter(item => item.kind === 'content-comment'), ...intake], text => {
      const content = restoreFeedbackDraft(text).filter(item => item.kind === 'content-comment');
      const restored = restoreFeedbackDraft(text).filter(item => item.kind === 'feature-comment');
      try { localStorage.setItem(commentKey, JSON.stringify({ schemaVersion: 1, interactions: content })); }
      finally { sessionStorage.setItem(intakeKey, JSON.stringify({ schemaVersion: 1, interactions: restored })); }
    });
  });
  const comments = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const [forms, setForms] = useState<ReviewArtifact['forms']>(recovery?.draft.forms ?? initial?.value.forms ?? []);
  const [progress, setProgress] = useState(recovery?.draft.progress ?? initial?.value.progress ?? []);
  const [selected, setSelected] = useState(initialSelected);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [draftVersion, setDraftVersion] = useState<string | null>(initial?.pin.version ?? null);
  const [draftId] = useState(recovery?.draft.id ?? initial?.value.id ?? `draft-${crypto.randomUUID()}`);
  const [saved, setSaved] = useState('');
  const [notice, setNotice] = useState<string>(recovery ? copy.recoveredDraft.text : initial ? copy.remoteDraft.text : copy.localComments.text);
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
    reviewer: listing.reviewer, forms, progress, comments: storeReviewComments(scope, review, comments.items.filter(item => item.kind === 'content-comment')),
  };
  function persist() {
    return writeRecovery(key, { version: 1, time: Date.now(), draft: { ...body, comments: [], kind: 'review-draft', id: draftId }, pending: recoveredPending.current });
  }
  useEffect(() => { persist(); }, [forms, progress]);
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
      if (submit && !content.forms.length && !content.comments.length && !content.progress.length && comments.items.some(item => item.kind === 'feature-comment')) throw new Error('Feature feedback remains in separate app intake. Answer a content form or add a content comment before submitting this review.');
      if (submit && responses.length && !content.forms.length && !content.comments.length && responses.some(item => JSON.stringify(item.value.progress) === JSON.stringify(content.progress))) {
        setNotice('This feedback already has a saved response receipt.'); return;
      }
      const identity = JSON.stringify({ submit, memberId, ...content });
      const digest = await recoveryFingerprint(identity);
      if (pending.current?.fingerprint !== identity) pending.current = { fingerprint: identity, value: submit
        ? { ...content, kind: 'review-response', intent: 'feedback', id: recoveredPending.current?.fingerprint === digest ? recoveredPending.current.id : `response-${crypto.randomUUID()}` }
        : { ...content, kind: 'review-draft', id: draftId } };
      const value = pending.current.value;
      recoveredPending.current = { fingerprint: digest, id: value.id };
      if (!persist()) setNotice('Browser recovery storage is unavailable or full. Keep this page open to retain answers and retry identity; do not reload yet.');
      if (memberId && !value.forms.length) throw new Error('Enter an answer before submitting this form.');
      await validateReviewArtifact(review.request, value, contentsCache.read);
      const receipt = await service.save(scope, value, submit ? null : draftVersion);
      if (!mounted.current) return;
      updateListing(current => current ? { ...current, artifacts: [...current.artifacts.filter(item => item.pin.resource !== receipt.resource), { value, pin: { resource: receipt.resource, version_kind: 'git-blob', version: receipt.version, snapshot: receipt.snapshot }, dispatch: receipt.dispatch }] } : current);
      if (!submit) { setDraftVersion(receipt.version); setSaved(fingerprint); }
      setNotice(submit ? `Response saved remotely. ${receipt.dispatch ? `${receipt.dispatch.kind === 'vk' ? 'VK notification' : 'Workflow delivery'}: ${receipt.dispatch.state}. ${receipt.dispatch.message ?? ''}` : 'Task notification is pending the agent intake receipt.'}` : 'Draft saved remotely. You can reopen this revision on another device.');
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function retry(value: ReviewArtifact) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const receipt = await service.save(scope, value, null);
      if (!mounted.current) return;
      updateListing(current => current ? { ...current, artifacts: current.artifacts.map(item => item.value.id === value.id && item.pin.version === receipt.version ? { ...item, pin: { ...item.pin, snapshot: receipt.snapshot }, dispatch: receipt.dispatch } : item) } : current);
      setNotice(`Response remains saved. ${receipt.dispatch?.kind === 'vk' ? 'VK notification' : 'Workflow delivery'}: ${receipt.dispatch?.state ?? 'unknown'}. ${receipt.dispatch?.message ?? ''}`);
    } catch (cause) { if (mounted.current) setError(String(cause)); }
    finally { if (mounted.current) setBusy(false); }
  }
  const latest = listing.requests.find(item => item.request.request_id === review.request.request_id);
  return { queue, scope, review, listing, latest, service, selected, forms, progress,
      responses, submitted, busy, dirty, notice, error, sidebarOpen, contents, documentZen,
      actions: { select: setSelected, toggleSidebar() { setSidebarOpen(open => !open); }, retryContents: () => void contentsCache.retryFailed(), answer, progress(id: string, checked: boolean) { setProgress(current => checked ? [...new Set([...current, id])] : current.filter(item => item !== id)); }, saveDraft: () => void save(false), submit: (id?: string) => void save(true, id), retry: (value: ReviewArtifact) => void retry(value), refresh } };
}
