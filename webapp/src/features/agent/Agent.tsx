import { useAgentFeature, useAgentLocation } from './Agent.hooks';
import { AgentPresentation } from './Agent.presentation';
export function Agent() {
  const location = useAgentLocation();
  return <AgentWorkspace key={JSON.stringify([location.connection, location.repository, location.workspace])} location={location} />;
}
function AgentWorkspace({ location }: { location: Record<string, unknown> }) {
  const props = useAgentFeature(location);
  return <AgentPresentation {...props} />;
}
