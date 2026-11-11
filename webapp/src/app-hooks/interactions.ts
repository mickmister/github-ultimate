import { bridgeRequest } from '../../../hosted/client';
import { createGitResourceResolver } from '../features/interactions/resources';
import type { BatchBinding } from '../features/interactions/batch';
import type { PreviewServices } from '../features/interactions/preview';
import type { WorkspaceScope } from './contracts';

/** Binding comes from the embedding host's verified workspace context, never the imported JSON. */
export function createHostedInteractionServices(scope: WorkspaceScope, binding: BatchBinding, snapshotCommit: string, adapters: Omit<PreviewServices, 'resolve'> = {}): PreviewServices {
  return { ...adapters, resolve: createGitResourceResolver({ send: bridgeRequest, scope, binding, snapshotCommit }) };
}
