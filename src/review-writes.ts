import { WorkspaceReader, documents, documentText, type GitTransport } from '../hosted/workspaces';
import { ReviewReader } from '../hosted/reviews';
import { artifactResource, parseReviewArtifact, parseReviewRequest, requestResource, validateReviewArtifact, type ReviewReceipt, type ReviewWrite } from './review-protocol';
import { z } from 'zod';

type Mutate = (path: string, method: 'POST' | 'PATCH', body: unknown) => Promise<unknown>;
const oidResult = z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) });

// Only review artifacts are writable. The broker, never the page, supplies identity
// and credentials. Non-force ref updates preserve concurrent document publishers.
export async function writeReview(request: ReviewWrite, reviewer: string, read: GitTransport, mutate: Mutate): Promise<ReviewReceipt> {
  const value = parseReviewArtifact(request.text);
  if (value.reviewer !== reviewer) throw new Error('The review artifact belongs to another authenticated reviewer.');
  if (value.kind === 'review-response' && request.expected !== null) throw new Error('Submitted responses are immutable create-only resources.');
  const reader = new WorkspaceReader(read, request.id, request.repository, request.installationId, request.workspace);
  const found = (await reader.discover()).find(item => item.name === request.workspace);
  if (!found) throw new Error('Workspace is unavailable.');
  const head = await reader.open(found);
  await reader.open({ ...found, documents: value.request.snapshot });
  const reviews = new ReviewReader(reader, request.workspace);
  const opened = await reviews.open({ resource: requestResource(value.request.id), version_kind: 'git-blob', version: value.request.version, snapshot: value.request.snapshot });
  // Require a request still present in the workspace. A newer revision is allowed:
  // the response intentionally remains bound to its original immutable revision.
  const currentEntry = documents(head.snapshot).find(entry => entry.path === `documents/${requestResource(value.request.id)}`);
  if (!currentEntry) throw new Error('This request is no longer present in the workspace.');
  const current = parseReviewRequest(documentText(await reader.blob(currentEntry)));
  if (current.workspace !== request.workspace || current.request_id !== value.request.id) throw new Error('Current request identity mismatch.');
  if (current.status === 'withdrawn') throw new Error('This request has been withdrawn. Existing responses remain available.');
  await validateReviewArtifact(opened.request, value, pin => reviews.read(pin));
  const resource = artifactResource(value);
  const path = `documents/${resource}`;
  const existing = documents(head.snapshot).find(entry => entry.path === path);
  const text = JSON.stringify(value, null, 2) + '\n';
  if (existing && documentText(await reader.blob(existing)) === text) return { resource, version: existing.sha, snapshot: head.snapshot.commit, reviewer };
  if ((existing?.sha ?? null) !== request.expected || value.kind === 'review-response' && existing) throw new Error('Review save conflict. Reload the remote draft; no changes were overwritten.');
  const base = `/repos/${request.repository}/git`;
  const blob = oidResult.parse(await mutate(`${base}/blobs`, 'POST', { content: text, encoding: 'utf-8' }));
  const tree = oidResult.parse(await mutate(`${base}/trees`, 'POST', { base_tree: head.snapshot.tree.sha, tree: [{ path, mode: '100644', type: 'blob', sha: blob.sha }] }));
  const commit = oidResult.parse(await mutate(`${base}/commits`, 'POST', { message: `${value.kind === 'review-draft' ? 'Save review draft' : 'Submit review response'} ${value.request.id}`, tree: tree.sha, parents: [head.snapshot.commit] }));
  await mutate(`${base}/refs/documents/${request.workspace}`, 'PATCH', { sha: commit.sha, force: false });
  // Verify both bytes and path membership after the write before issuing a receipt.
  const saved = await reviews.read({ resource, version_kind: 'git-blob', version: blob.sha, snapshot: commit.sha });
  if (saved !== text) throw new Error('Review artifact readback did not match the submitted bytes.');
  return { resource, version: blob.sha, snapshot: commit.sha, reviewer };
}
