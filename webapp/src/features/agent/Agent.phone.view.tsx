import type { SurfaceProps } from '../../presentation/Presentation';
import { AgentHeader, AgentRemote, AgentSetup, AgentConversation, AgentScratch, type AgentProps } from './Agent.view';
import { copy } from './Agent.copy';
export function AgentPhoneView(p: SurfaceProps<AgentProps>) {
  return <main className="agent-page agent-phone" data-surface="phone" data-orientation={p.presentation.orientation}><AgentHeader {...p} /><AgentRemote {...p} /><details open={!p.model.runtime}><summary>{copy.setup}</summary><AgentSetup {...p} /></details><AgentConversation {...p} /><details><summary>{copy.scratch}</summary><AgentScratch {...p} /></details></main>;
}
