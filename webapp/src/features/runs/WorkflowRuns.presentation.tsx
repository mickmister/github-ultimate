import { defineDevicePage } from '../../presentation/Presentation';
import type { WorkflowRunsProps } from './WorkflowRuns.view';
import { WorkflowRunsPhoneView } from './WorkflowRuns.phone.view';
import { WorkflowRunsTabletView } from './WorkflowRuns.tablet.view';
import { WorkflowRunsDesktopView } from './WorkflowRuns.desktop.view';
import './runs.css';
export const WorkflowRunsPresentation = defineDevicePage<WorkflowRunsProps>({
  id: 'runs', phone: WorkflowRunsPhoneView, tablet: WorkflowRunsTabletView, desktop: WorkflowRunsDesktopView,
});
