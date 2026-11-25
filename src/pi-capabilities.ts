import { workflowTools } from './workflow-interface';
import { beadsCapability } from './beads-query';
import { workspaceContextCapabilities } from './workspace-context-interface';
export const piCapabilities = [...workflowTools, beadsCapability, ...workspaceContextCapabilities];
