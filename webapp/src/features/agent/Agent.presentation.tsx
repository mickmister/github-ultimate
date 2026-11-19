import { defineDevicePage } from '../../presentation/Presentation';
import type { AgentProps } from './Agent.view';
import { AgentPhoneView } from './Agent.phone.view';
import { AgentTabletView } from './Agent.tablet.view';
import { AgentDesktopView } from './Agent.desktop.view';
import './agent.css';
export const AgentPresentation = defineDevicePage<AgentProps>({ id: 'agent', phone: AgentPhoneView, tablet: AgentTabletView, desktop: AgentDesktopView });
