import type { PublicInferenceConnection } from '../src/inference-protocol';
import type { PublicS3Connection } from '../src/s3-protocol';
export type SavedChat = { sessionId: string; reference: string; label: string };
export type ChatSnapshot = { sessionId?: string; reference?: string; title: string; messages: { role: string; content?: unknown }[]; busy: boolean; dirty: boolean; phase: 'idle' | 'pending' | 'interrupted'; error?: string };
export interface ChatHandle {
  snapshot(): ChatSnapshot;
  subscribe(listener: () => void): () => void;
  retrySave(): Promise<void>;
  send(text?: string): Promise<void>;
  stop(): void;
}
export interface PiWebRuntime {
  connections(): Promise<{ inference: PublicInferenceConnection[]; storage: PublicS3Connection[] }>;
  storageId(storage: PublicS3Connection): string;
  list(storage: PublicS3Connection, token?: string): Promise<{ chats: SavedChat[]; token?: string }>;
  create(inference: PublicInferenceConnection, storage: PublicS3Connection): ChatHandle;
  restore(inference: PublicInferenceConnection, storage: PublicS3Connection, sessionId: string, reference: string): Promise<ChatHandle>;
}
declare global { interface Window { piWebExtension: PiWebRuntime } }
