import { bridgeRequest } from './client';
import { BrowserChat, ChatStorage, chatStorageId } from './pi-chat';
import type { PublicInferenceConnection } from '../src/inference-protocol';
import type { PublicS3Connection } from '../src/s3-protocol';
import type {} from './pi-chat-contract';
import { mobilePiRequest } from '../src/mobile-pi-client';
import type { PiBridge } from './pi-transport';
import { loadPreviewSlots } from './preview-slots';
import type { ChatWorkspace } from './pi-chat-contract';

// Keep native Pi transfer assembly out of the independently budgeted legacy pages.
const bridge: PiBridge = (request, timeoutMs) => bridgeRequest(request, timeoutMs, mobilePiRequest);

window.piWebExtension = {
  protocolVersion: 2,
  connections: async () => ({ inference: await bridge<PublicInferenceConnection[]>({ operation: 'inferenceConnections' }), storage: await bridge<PublicS3Connection[]>({ operation: 's3Connections' }) }),
  storageId: chatStorageId,
  list: (storage: PublicS3Connection) => new ChatStorage(bridge, storage).list(),
  // Git/nugs reads use the existing GitHub bridge, not the Pi-only native
  // transfer protocol. Credentials remain in the approved host connection.
  previews: (search: string) => loadPreviewSlots(bridgeRequest, search),
  create: (inference: PublicInferenceConnection, storage: PublicS3Connection, workspace?: ChatWorkspace) => new BrowserChat(new ChatStorage(bridge, storage), inference, bridge, undefined, workspace),
  move: async (storage: PublicS3Connection, sessionId: string, workspace: ChatWorkspace | null) => {
    const objects = new ChatStorage(bridge, storage);
    if (!(await objects.list()).chats.some(chat => chat.sessionId === sessionId)) throw Error('Conversation no longer exists in this storage.');
    await objects.assign(sessionId, workspace);
  },
  restore: async (inference: PublicInferenceConnection, storage: PublicS3Connection, sessionId: string, reference: string) => {
    const objects = new ChatStorage(bridge, storage);
    return new BrowserChat(objects, inference, bridge, { checkpoint: await objects.read(sessionId, reference), reference });
  },
};
