import { bridgeRequest } from './client';
import { BrowserChat, ChatStorage, chatStorageId } from './pi-chat';
import type { PublicInferenceConnection } from '../src/inference-protocol';
import type { PublicS3Connection } from '../src/s3-protocol';
import type { PiWebRuntime } from './pi-chat-contract';
import { mobilePiRequest } from '../src/mobile-pi-client';
import type { PiBridge } from './pi-transport';
import { loadPreviewSlots } from './preview-slots';
import type { ChatWorkspace } from './pi-chat-contract';
import { PiBeads } from './pi-beads';
import { openPageStorage } from './page-storage';

// Keep native Pi transfer assembly out of the independently budgeted legacy pages.
const bridge: PiBridge = (request, timeoutMs) => bridgeRequest(request, timeoutMs, mobilePiRequest);
const workspace = () => {
  const params = new URLSearchParams(location.search), repository = params.get('repository'), workspace = params.get('workspace');
  return repository && workspace ? { repository, workspace } : undefined;
};
export function createPiWebRuntime(beads = new PiBeads(bridgeRequest)): PiWebRuntime {
  const options = { workspace, beadsQuery: beads.query.bind(beads) };
  let settings: ReturnType<typeof openPageStorage> | undefined;
  return {
  protocolVersion: 2,
  beads: (selected, connectionId) => beads.select(selected, connectionId),
  preferences: async () => (await (settings ??= openPageStorage())).storage,
  connections: async () => ({ inference: await bridge<PublicInferenceConnection[]>({ operation: 'inferenceConnections' }), storage: await bridge<PublicS3Connection[]>({ operation: 's3Connections' }) }),
  storageId: chatStorageId,
  list: (storage: PublicS3Connection) => new ChatStorage(bridge, storage).list(),
  importCopied: (storage: PublicS3Connection) => new ChatStorage(bridge, storage).importCopied(),
  // Git/nugs reads use the existing GitHub bridge, not the Pi-only native
  // transfer protocol. Credentials remain in the approved host connection.
  previews: (search: string) => loadPreviewSlots(bridgeRequest, search),
  create: (inference: PublicInferenceConnection, storage: PublicS3Connection, selected?: ChatWorkspace) => new BrowserChat(new ChatStorage(bridge, storage), inference, bridge, undefined, selected, bridgeRequest, options),
  move: async (storage: PublicS3Connection, sessionId: string, workspace: ChatWorkspace | null) => {
    const objects = new ChatStorage(bridge, storage);
    if (!(await objects.list()).chats.some(chat => chat.sessionId === sessionId)) throw Error('Conversation no longer exists in this storage.');
    await objects.assign(sessionId, workspace);
  },
  restore: async (inference: PublicInferenceConnection, storage: PublicS3Connection, sessionId: string, reference: string) => {
    const objects = new ChatStorage(bridge, storage);
    return new BrowserChat(objects, inference, bridge, { checkpoint: await objects.read(sessionId, reference), reference }, undefined, bridgeRequest, options);
  },
  };
}
window.piWebExtension = createPiWebRuntime();
