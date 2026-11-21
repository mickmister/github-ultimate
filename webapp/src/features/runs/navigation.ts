import type { WorkspaceScope } from '../../app-hooks/contracts';
import type { WorkspaceRun } from '../../../../hosted/workflow-runs';

export function runsHref(scope: WorkspaceScope, run?: WorkspaceRun) {
  return `#/runs?${new URLSearchParams({ connection: scope.connectionId, repository: scope.repository, workspace: scope.workspace, ...(run ? { run: run.key } : {}) })}`;
}
