import { WorkspaceReader, documentText } from '../../../../hosted/workspaces';
import type { WorkspaceScope } from '../../app-hooks/contracts';
import type { GitTransport, Snapshot } from '../../../../hosted/workspaces';
import { InteractionError, type BatchBinding } from './batch';
import type { InteractionResource } from './schema';

export interface ResolvedResource {
  readonly reference: InteractionResource;
  readonly blobOid: string;
  readonly path: string;
  readonly snapshotCommit: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly text?: string;
  readonly dimensions?: { readonly width: number; readonly height: number };
}
export type ResourceResolver = (reference: InteractionResource, signal?: AbortSignal) => Promise<ResolvedResource>;

/** Uses the same installation-scoped broker and integrity-checked blobs as Documents. */
export function createGitResourceResolver(options: {
  readonly send: GitTransport;
  readonly scope: WorkspaceScope;
  readonly binding: BatchBinding;
  /** Trusted selected snapshot for membership checking direct blob references. */
  readonly snapshotCommit: string;
  readonly imageDimensions?: (bytes: Uint8Array<ArrayBuffer>) => Promise<{ width: number; height: number }>;
}): ResourceResolver {
  if (options.scope.repository !== options.binding.repository || options.scope.workspace !== options.binding.namespace) throw new InteractionError('workspace-binding', 'Resource reader scope does not match the selected binding.');
  const reader = new WorkspaceReader(options.send, options.scope.connectionId, options.scope.repository, options.scope.installationId, options.scope.workspace);
  const dimensions = options.imageDimensions ?? (async bytes => {
    const image = await createImageBitmap(new Blob([bytes]));
    try { return { width: image.width, height: image.height }; } finally { image.close(); }
  });
  return async (reference, signal) => {
    signal?.throwIfAborted();
    if (reference.repository && reference.repository !== options.binding.repository || reference.workspace && reference.workspace !== options.binding.namespace) throw new InteractionError('resource-scope', 'Resource belongs to a different workspace or repository.');
    if (reference.revisionKind === 'sha256') throw new InteractionError('unsupported-reference', 'A trusted digest-store resolver is required for SHA-256 content references.');
    const commit = reference.revisionKind === 'git-commit' ? reference.revision : options.snapshotCommit;
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new InteractionError('invalid-snapshot', 'Expected an immutable selected snapshot commit.');
    const snapshot: Snapshot = await reader.snapshot(commit);
    signal?.throwIfAborted();
    const path = reference.path;
    if (path !== undefined && (!path || /[\\\0\r\n]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git'))) throw new InteractionError('invalid-path', 'Expected a document-relative path.');
    if (reference.revisionKind === 'git-commit' && !path) throw new InteractionError('missing-path', 'Commit references need an exact resource path.');
    const matches = snapshot.tree.tree.filter(entry => entry.path.startsWith('documents/') && entry.type === 'blob'
      && (path === undefined || entry.path === `documents/${path}`)
      && (reference.revisionKind !== 'git-blob' || entry.sha === reference.revision));
    if (matches.length !== 1) throw new InteractionError(matches.length ? 'ambiguous-resource' : 'missing-resource', 'Resource is missing or ambiguous in the pinned snapshot.');
    const entry = matches[0];
    // Current Documents IDs are blob:path, unlike future native stable document IDs.
    if (reference.id.includes(':') && /^[a-f0-9]{40}:/.test(reference.id) && reference.id !== `${entry.sha}:${entry.path}`) throw new InteractionError('resource-identity', 'Captured document identity differs from the pinned tree entry.');
    const bytes = await reader.blob(entry);
    signal?.throwIfAborted();
    const resolved = { reference, blobOid: entry.sha, path: entry.path, snapshotCommit: snapshot.commit, bytes };
    if (reference.kind === 'document') return { ...resolved, text: documentText(bytes) };
    const imageSize = await dimensions(bytes);
    signal?.throwIfAborted();
    if (![imageSize.width, imageSize.height].every(value => Number.isSafeInteger(value) && value > 0)) throw new InteractionError('image-dimensions', 'Image decoder returned invalid dimensions.');
    return { ...resolved, dimensions: imageSize };
  };
}
