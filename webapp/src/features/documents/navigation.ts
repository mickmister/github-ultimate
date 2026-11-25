export interface DocumentLocation {
  readonly connection?: string;
  readonly repository?: string;
  readonly workspace?: string;
  readonly documentId?: string;
}
export interface DocumentNavigation {
  readonly location: DocumentLocation;
  readonly navigate: (location: DocumentLocation) => void;
}
export function parseDocumentSearch(search: Record<string, unknown>): Omit<DocumentLocation, 'documentId'> {
  return {
    connection: typeof search.connection === 'string' ? search.connection : undefined,
    repository: typeof search.repository === 'string' ? search.repository : undefined,
    workspace: typeof search.workspace === 'string' ? search.workspace : undefined,
  };
}
