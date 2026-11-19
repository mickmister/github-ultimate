import type { SurfaceProps } from '../../presentation/Presentation';
import { RunsHeader, RunsWorkspace, RunsStatus, RunsList, RunsAttempt, type WorkflowRunsProps } from './WorkflowRuns.view';
import { copy } from './WorkflowRuns.copy';
export function WorkflowRunsTabletView(p: SurfaceProps<WorkflowRunsProps>) {
  return <main className="app-shell workflow-runs runs-tablet" data-surface="tablet" data-orientation={p.presentation.orientation}>
    <RunsHeader {...p} />
    <section className="runs-tablet-workspace"><h2>{copy.workspaceSettings}</h2><RunsWorkspace {...p} /></section>
    <div className="runs-tablet-content"><RunsStatus {...p} />{p.selected ? <RunsAttempt {...p} /> : <RunsList {...p} />}</div>
  </main>;
}
