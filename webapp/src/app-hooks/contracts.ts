export interface ConnectionDTO {
  readonly id: string;
  readonly name: string;
  readonly installationId: number;
  readonly account: string;
}
export interface WorkspaceScope {
  readonly connectionId: string;
  readonly installationId: number;
  readonly repository: string;
  readonly workspace: string;
}
export interface WorkspaceDTO { readonly id: string; readonly hasDocuments: boolean }
export interface DocumentDTO { readonly id: string; readonly path: string; readonly size: number | null }
export interface DocumentSnapshotDTO {
  readonly id: string;
  readonly commit: string;
  readonly purpose: string;
  readonly documents: readonly DocumentDTO[];
}
export interface DocumentsModuleV1 {
  readonly version: 1;
  readonly connect: () => Promise<readonly ConnectionDTO[]>;
  readonly discover: (scope: Omit<WorkspaceScope, 'workspace'>) => Promise<readonly WorkspaceDTO[]>;
  readonly open: (scope: WorkspaceScope) => Promise<DocumentSnapshotDTO>;
  readonly read: (snapshotId: string, documentId: string) => Promise<string>;
  readonly dispose: () => void;
  readonly navigation?: {
    load(): Promise<WorkspaceNavigation | null>;
    save(value: WorkspaceNavigation): Promise<void>;
    forget(): Promise<void>;
  };
}
export interface AppHooksV1 {
  readonly contractVersion: 1;
  readonly modules: { readonly documents: DocumentsModuleV1; readonly reviews?: import('./reviews').ReviewsModuleV1 };
}
import type { WorkspaceNavigation } from '../../../src/workspace-navigation';
