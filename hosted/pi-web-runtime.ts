import { bridgeRequest } from './client';
import { BrowserChat, ChatStorage, chatStorageId } from './pi-chat';
import type { PublicInferenceConnection } from '../src/inference-protocol';
import type { PublicS3Connection } from '../src/s3-protocol';
import type {} from './pi-chat-contract';
import { mobilePiRequest } from '../src/mobile-pi-client';
import type { PiBridge } from './pi-transport';

// Keep native Pi transfer assembly out of the independently budgeted legacy pages.
const bridge: PiBridge = (request, timeoutMs) => bridgeRequest(request, timeoutMs, mobilePiRequest);

window.piWebExtension = {
  protocolVersion: 2,
  connections: async () => ({ inference: await bridge<PublicInferenceConnection[]>({ operation: 'inferenceConnections' }), storage: await bridge<PublicS3Connection[]>({ operation: 's3Connections' }) }),
  storageId: chatStorageId,
  list: (storage: PublicS3Connection) => new ChatStorage(bridge, storage).list(),
  create: (inference: PublicInferenceConnection, storage: PublicS3Connection) => new BrowserChat(new ChatStorage(bridge, storage), inference, bridge),
  restore: async (inference: PublicInferenceConnection, storage: PublicS3Connection, sessionId: string, reference: string) => {
    const objects = new ChatStorage(bridge, storage);
    return new BrowserChat(objects, inference, bridge, { checkpoint: await objects.read(sessionId, reference), reference });
  },
};
