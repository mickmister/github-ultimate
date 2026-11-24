import type { PublicInferenceConnection } from '../src/inference-protocol';
import type { PublicS3Connection } from '../src/s3-protocol';
import type { PreviewCatalog } from './preview-slots';
export type ChatWorkspace = { repository: string; workspace: string };
export type SavedChat = { sessionId: string; reference: string; label: string; updatedAt: string; messageCount: number; workspace?: ChatWorkspace };
export type ChatSnapshot = { sessionId?: string; reference?: string; title: string; messages: { role: string; content?: unknown }[]; busy: boolean; dirty: boolean; phase: 'idle' | 'pending' | 'interrupted'; error?: string; streaming?: boolean };
export interface ChatHandle {
  snapshot(): ChatSnapshot;
  subscribe(listener: () => void): () => void;
  retrySave(): Promise<void>;
  send(text?: string): Promise<void>;
  stop(): void;
}
export interface PiWebRuntime {
  protocolVersion: 2;
  connections(): Promise<{ inference: PublicInferenceConnection[]; storage: PublicS3Connection[] }>;
  storageId(storage: PublicS3Connection): string;
  list(storage: PublicS3Connection): Promise<{ chats: SavedChat[] }>;
  previews(search: string): Promise<PreviewCatalog>;
  create(inference: PublicInferenceConnection, storage: PublicS3Connection, workspace?: ChatWorkspace): ChatHandle;
  move(storage: PublicS3Connection, sessionId: string, workspace: ChatWorkspace | null): Promise<void>;
  restore(inference: PublicInferenceConnection, storage: PublicS3Connection, sessionId: string, reference: string): Promise<ChatHandle>;
}
declare global { interface Window { piWebExtension: PiWebRuntime } }
