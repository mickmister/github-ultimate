import type { SurfaceProps } from '../../presentation/Presentation';
import { AgentHeader, AgentRemote, AgentSetup, AgentConversation, AgentScratch, type AgentProps } from './Agent.view';
export function AgentDesktopView(p: SurfaceProps<AgentProps>) {
  return <main className="agent-page agent-desktop" data-surface="desktop" data-orientation={p.presentation.orientation}><AgentHeader {...p} /><AgentRemote {...p} /><div className="agent-desktop-work"><aside><AgentSetup {...p} /></aside><AgentConversation {...p} /><aside><AgentScratch {...p} /></aside></div></main>;
}
