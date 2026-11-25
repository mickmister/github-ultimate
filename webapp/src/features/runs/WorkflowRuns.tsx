import { useRunsLocation, useWorkflowRunsFeature, type WorkflowRunsOptions } from './WorkflowRuns.hooks';
import { WorkflowRunsPresentation } from './WorkflowRuns.presentation';
export { parseRunsSearch } from './WorkflowRuns.hooks';
export function RoutedRuns() {
  const location = useRunsLocation();
  return <WorkflowRuns key={JSON.stringify(location)} location={location} />;
}
export function WorkflowRuns(options: WorkflowRunsOptions) {
  const props = useWorkflowRunsFeature(options);
  return <WorkflowRunsPresentation {...props} />;
}
