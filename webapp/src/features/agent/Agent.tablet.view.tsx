import type { SurfaceProps } from '../../presentation/Presentation';
import { AgentHeader, AgentRemote, AgentSetup, AgentConversation, AgentScratch, type AgentProps } from './Agent.view';
import { copy } from './Agent.copy';
export function AgentTabletView(p: SurfaceProps<AgentProps>) {
  return <main className="agent-page agent-tablet" data-surface="tablet" data-orientation={p.presentation.orientation}><AgentHeader {...p} /><AgentRemote {...p} /><div className="agent-tablet-work"><aside><details open={!p.model.runtime}><summary>{copy.setup}</summary><AgentSetup {...p} /></details></aside><AgentConversation {...p} /></div><AgentScratch {...p} /></main>;
}
