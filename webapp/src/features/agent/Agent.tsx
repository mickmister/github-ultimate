import { useAgentFeature, useAgentLocation } from './Agent.hooks';
import { AgentPresentation } from './Agent.presentation';
export function Agent() {
  const location = useAgentLocation();
  const props = useAgentFeature(location);
  return <AgentPresentation {...props} />;
}
