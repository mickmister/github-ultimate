import type { SurfaceProps } from '../../presentation/Presentation';
import { RunsHeader, RunsWorkspace, RunsStatus, RunsList, RunsAttempt, type WorkflowRunsProps } from './WorkflowRuns.view';
import { copy } from './WorkflowRuns.copy';
export function WorkflowRunsDesktopView(p: SurfaceProps<WorkflowRunsProps>) {
  return <main className="app-shell workflow-runs runs-desktop" data-surface="desktop" data-orientation={p.presentation.orientation}>
    <RunsHeader {...p} />
    <div className="runs-desktop-layout"><aside><h2>{copy.workspaceSettings}</h2><RunsWorkspace {...p} /></aside>
      <div className="runs-desktop-content"><RunsStatus {...p} />{p.selected ? <RunsAttempt {...p} /> : <RunsList {...p} />}</div>
    </div>
  </main>;
}
