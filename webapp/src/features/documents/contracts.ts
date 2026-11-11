import type { ComponentType } from 'react';
import type { ConnectionDTO, DocumentSnapshotDTO, WorkspaceDTO } from '../../app-hooks/contracts';
import type { TreeAppearance } from './tree-appearance';

export interface DocumentBrowserModel {
  readonly connections: readonly ConnectionDTO[];
  readonly connectionId: string;
  readonly repository: string;
  readonly workspaces: readonly WorkspaceDTO[];
  readonly workspaceId: string;
  readonly snapshot: DocumentSnapshotDTO | null;
  readonly documentId: string;
  readonly query: string;
  readonly expandedFolders: readonly string[];
  readonly treeAppearance: TreeAppearance;
  readonly content: string | null;
  readonly documentMode: 'source' | 'markdown';
  readonly documentFullscreen: boolean;
  readonly busy: boolean;
  readonly status: string;
  readonly error: string | null;
  readonly canDiscover: boolean;
  readonly canBrowse: boolean;
}
export interface DocumentBrowserActions {
  connect(): void;
  forgetWorkspace?(): void;
  selectConnection(id: string): void;
  setRepository(repository: string): void;
  discoverWorkspaces(): void;
  selectWorkspace(id: string): void;
  browseDocuments(): void;
  setQuery(query: string): void;
  setExpandedFolders(paths: readonly string[]): void;
  setTreeAppearance(appearance: TreeAppearance): void;
  selectDocument(id: string): void;
  setDocumentMode(mode: 'source' | 'markdown'): void;
  setDocumentFullscreen(fullscreen: boolean): void;
}
export interface DocumentBrowserProps {
  readonly model: DocumentBrowserModel;
  readonly actions: DocumentBrowserActions;
}
export type DocumentBrowserPresentation = ComponentType<DocumentBrowserProps>;
