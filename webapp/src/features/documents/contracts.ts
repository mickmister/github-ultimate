import type { ComponentType } from 'react';
import type { ConnectionDTO, DocumentSnapshotDTO, WorkspaceDTO } from '../../app-hooks/contracts';

export interface DocumentBrowserModel {
  readonly connections: readonly ConnectionDTO[];
  readonly connectionId: string;
  readonly repository: string;
  readonly workspaces: readonly WorkspaceDTO[];
  readonly workspaceId: string;
  readonly snapshot: DocumentSnapshotDTO | null;
  readonly documentId: string;
  readonly query: string;
  readonly content: string | null;
  readonly busy: boolean;
  readonly status: string;
  readonly error: string | null;
  readonly canDiscover: boolean;
  readonly canBrowse: boolean;
}
export interface DocumentBrowserActions {
  connect(): void;
  selectConnection(id: string): void;
  setRepository(repository: string): void;
  discoverWorkspaces(): void;
  selectWorkspace(id: string): void;
  browseDocuments(): void;
  setQuery(query: string): void;
  selectDocument(id: string): void;
}
export interface DocumentBrowserProps {
  readonly model: DocumentBrowserModel;
  readonly actions: DocumentBrowserActions;
}
export type DocumentBrowserPresentation = ComponentType<DocumentBrowserProps>;
