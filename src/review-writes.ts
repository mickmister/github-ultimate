import { WorkspaceReader, documents, documentText, type GitTransport } from '../hosted/workspaces';
import type { ReviewReceipt, ReviewWrite } from './review-protocol';
import { reviewIOEnvelope, reviewIOResource, reviewDeliveryRoute, sameReviewPayload, type ReviewDeliveryRoute } from './review-io';
import { z } from 'zod';
import { verifiedGitBlobBytes } from './git-blob';

type Mutate = (path: string, method: 'POST' | 'PATCH', body: unknown) => Promise<unknown>;
const oidResult = z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) });

// Only review artifacts are writable. The broker, never the page, supplies identity
// and credentials. Non-force ref updates preserve concurrent document publishers.
export type ReviewDelivery = (receipt: ReviewReceipt, request: ReviewDeliveryRoute) => Promise<ReviewReceipt>;
export async function writeReview(request: ReviewWrite, reviewer: string, read: GitTransport, mutate: Mutate, deliver?: ReviewDelivery): Promise<ReviewReceipt> {
  const value = reviewIOEnvelope(request.text);
  if (value.reviewer !== reviewer) throw new Error('The review artifact belongs to another authenticated reviewer.');
  if (value.kind === 'review-response' && request.expected !== null) throw new Error('Submitted responses are immutable create-only resources.');
  const reader = new WorkspaceReader(read, request.id, request.repository, request.installationId, request.workspace, 'documents', verifiedGitBlobBytes);
  const found = (await reader.discover()).find(item => item.name === request.workspace);
  if (!found) throw new Error('Workspace is unavailable.');
  const head = await reader.open(found);
  const resource = `review-requests/${value.request.id}/request.json`;
  const pinned = await reader.snapshot(value.request.snapshot);
  const entry = documents(pinned).find(item => item.path === `documents/${resource}` && item.sha === value.request.version);
  if (!entry) throw new Error('Pinned review request is unavailable.');
  // Read immutable routing authority, not form definitions or answer semantics.
  const route = reviewDeliveryRoute(documentText(await reader.blob(entry)));
  if (route.workspace !== request.workspace || route.request_id !== value.request.id) throw new Error('Pinned request identity mismatch.');
  // Require a request still present in the workspace. A newer revision is allowed:
  // the response intentionally remains bound to its original immutable revision.
  const currentEntry = documents(head.snapshot).find(entry => entry.path === `documents/${resource}`);
  if (!currentEntry) throw new Error('This request is no longer present in the workspace.');
  const current = reviewDeliveryRoute(documentText(await reader.blob(currentEntry)));
  if (current.workspace !== request.workspace || current.request_id !== value.request.id) throw new Error('Current request identity mismatch.');
  const finish = async (receipt: ReviewReceipt): Promise<ReviewReceipt> => {
    if (value.kind !== 'review-response' || !route.process && !route.response_effect) return receipt;
    if (!route.process && value.request.version !== currentEntry.sha) return { ...receipt, dispatch: { kind: 'vk', state: 'pending', message: 'Response saved against a superseded request. Automatic VK notification was withheld.' } };
    if (!deliver) return { ...receipt, dispatch: { state: 'pending' as const, message: 'Response saved; trusted continuation delivery is not configured.' } };
    try { return await deliver(receipt, route); }
    catch (error) {
      if (!route.process) return { ...receipt, dispatch: { kind: 'vk', state: 'unknown', message: 'Response saved; VK delivery evidence is unavailable. Inspect the destination and restore connection storage before retrying. No automatic replay was attempted.' } };
      return { ...receipt, dispatch: { state: 'failed' as const, message: error instanceof Error ? error.message : 'Workflow delivery failed. Retry the saved response.' } };
    }
  };
  const destination = reviewIOResource(value);
  const path = `documents/${destination}`;
  const existing = documents(head.snapshot).find(entry => entry.path === path);
  const text = request.text;
  if (existing && sameReviewPayload(documentText(await reader.blob(existing)), text)) return finish({ resource: destination, version: existing.sha, snapshot: head.snapshot.commit, reviewer });
  if ((existing?.sha ?? null) !== request.expected || value.kind === 'review-response' && existing) throw new Error('Review save conflict. Reload the remote draft; no changes were overwritten.');
  const base = `/repos/${request.repository}/git`;
  const blob = oidResult.parse(await mutate(`${base}/blobs`, 'POST', { content: text, encoding: 'utf-8' }));
  const tree = oidResult.parse(await mutate(`${base}/trees`, 'POST', { base_tree: head.snapshot.tree.sha, tree: [{ path, mode: '100644', type: 'blob', sha: blob.sha }] }));
  const commit = oidResult.parse(await mutate(`${base}/commits`, 'POST', { message: `${value.kind === 'review-queue-state' ? 'Categorize review' : value.kind === 'review-draft' ? 'Save review draft' : 'Submit review response'} ${value.request.id}`, tree: tree.sha, parents: [head.snapshot.commit] }));
  await mutate(`${base}/refs/documents/${request.workspace}`, 'PATCH', { sha: commit.sha, force: false });
  // Verify both bytes and path membership after the write before issuing a receipt.
  const snapshot = await reader.snapshot(commit.sha);
  const savedEntry = documents(snapshot).find(item => item.path === path && item.sha === blob.sha);
  if (!savedEntry) throw new Error('Review artifact readback path did not match.');
  const saved = documentText(await reader.blob(savedEntry));
  if (saved !== text) throw new Error('Review artifact readback did not match the submitted bytes.');
  return finish({ resource: destination, version: blob.sha, snapshot: commit.sha, reviewer });
}
