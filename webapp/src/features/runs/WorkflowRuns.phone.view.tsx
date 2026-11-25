import type { SurfaceProps } from '../../presentation/Presentation';
import { RunsHeader, RunsWorkspace, RunsStatus, RunsList, RunsAttempt, type WorkflowRunsProps } from './WorkflowRuns.view';
import { copy } from './WorkflowRuns.copy';
export function WorkflowRunsPhoneView(p: SurfaceProps<WorkflowRunsProps>) {
  return <main className="app-shell workflow-runs runs-phone" data-surface="phone" data-orientation={p.presentation.orientation}>
    <RunsHeader {...p} />
    <details open={!p.inventory}><summary>{copy.workspaceSettings}</summary><RunsWorkspace {...p} /></details>
    <RunsStatus {...p} />
    {p.selected ? <RunsAttempt {...p} /> : <RunsList {...p} />}
  </main>;
}
