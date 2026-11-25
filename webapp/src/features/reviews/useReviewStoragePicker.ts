import { useEffect, useState } from 'react';
import type { ConnectionDTO, DocumentsModuleV1, RepositoryDTO } from '../../app-hooks/contracts';

export function useReviewStoragePicker(documents: DocumentsModuleV1, connections: readonly ConnectionDTO[], connectionId: string, initial: { repository?: string; workspace?: string; requestId?: string }) {
  const [repository, setRepository] = useState(initial.repository ?? '');
  const [workspace, setWorkspace] = useState(initial.workspace ?? '');
  const [repositories, setRepositories] = useState<readonly RepositoryDTO[]>([]);
  const [workspaces, setWorkspaces] = useState<readonly string[]>([]);
  const [repositoriesBusy, setRepositoriesBusy] = useState(false);
  const [workspacesBusy, setWorkspacesBusy] = useState(false);
  const [repositoryError, setRepositoryError] = useState('');
  const [workspaceError, setWorkspaceError] = useState('');
  const [revision, setRevision] = useState(0);
  const connection = connections.find(item => item.id === connectionId);
  // Complete deep links already identify their source. Discovery must not add
  // any requests to the pinned detail page's cold-start path.
  const linkedDetail = Boolean(initial.requestId && initial.repository && initial.workspace);
  useEffect(() => {
    if (!connection || linkedDetail || !documents.repositories) return;
    let cancelled = false;
    setRepositoriesBusy(true); setRepositoryError('');
    void documents.repositories(connection.id).then(found => {
      if (cancelled) return;
      const sorted = [...found].sort((a, b) => a.fullName.localeCompare(b.fullName));
      setRepositories(sorted);
      if (sorted.length === 1) setRepository(current => current || sorted[0].fullName);
    }).catch(cause => { if (!cancelled) setRepositoryError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!cancelled) setRepositoriesBusy(false); });
    return () => { cancelled = true; };
  }, [documents, connection, linkedDetail, revision]);
  useEffect(() => {
    if (!connection || !repository || linkedDetail) return;
    let cancelled = false;
    setWorkspacesBusy(true); setWorkspaceError('');
    void documents.discover({ connectionId: connection.id, installationId: connection.installationId, repository }).then(found => {
      if (cancelled) return;
      const names = found.filter(item => item.hasDocuments).map(item => item.id).sort();
      setWorkspaces(names);
      if (names.length === 1) setWorkspace(current => current || names[0]);
    }).catch(cause => { if (!cancelled) setWorkspaceError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!cancelled) setWorkspacesBusy(false); });
    return () => { cancelled = true; };
  }, [documents, connection, repository, linkedDetail, revision]);
  return {
    repository, workspace, repositories, workspaces, repositoriesBusy, workspacesBusy, repositoryError, workspaceError,
    canListRepositories: Boolean(documents.repositories),
    clearConnection() {
      setRepository(''); setWorkspace(''); setRepositories([]); setWorkspaces([]);
      setRepositoryError(''); setWorkspaceError(''); setRepositoriesBusy(false); setWorkspacesBusy(false);
    },
    chooseRepository(value: string) { setRepository(value); setWorkspace(''); setWorkspaces([]); setWorkspaceError(''); setWorkspacesBusy(false); },
    chooseWorkspace: setWorkspace,
    retry() { setRevision(value => value + 1); },
  };
}

export type ReviewStoragePicker = ReturnType<typeof useReviewStoragePicker>;
