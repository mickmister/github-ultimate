import type { Meta, StoryObj } from '@storybook/react-vite';
import { AgentPresentation } from '../src/features/agent/Agent.presentation';
import type { AgentProps } from '../src/features/agent/Agent.view';
import { PresentationProvider } from '../src/presentation/Presentation';
import type { Presentation } from '../src/presentation/geometry';
import { Scratch } from '../../src/scratch';

function AgentFixture({ presentation }: { presentation: Presentation }) {
  const scratch = new Scratch(); scratch.write('README.md', '# Draft workspace\n', 0); scratch.commit('Initialize example', 1, null, 0);
  const noop = () => {};
  const props: AgentProps = { documentsHref: '#/documents', model: { scratch, fields: { prompt: 'Update the README', repository: 'example/project', inference: '', github: '', storage: '', session: '', checkpoint: '', commit: '', directory: '', script: '', message: '' }, inferences: [], githubs: [], stores: [], checkpoints: [], busy: false, dirty: false, error: '', status: '', output: '', transcript: () => '' }, actions: { edit: noop, connect: noop, create: noop, list: noop, restore: noop, save: noop, prompt: noop, script: noop, commit: noop, diff: noop, stop: noop } };
  return <PresentationProvider value={presentation}><AgentPresentation {...props} /></PresentationProvider>;
}
const meta = { title: 'Agent/Surfaces', component: AgentPresentation, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof AgentPresentation>;
export default meta;
type Story = StoryObj;
const surface = (presentation: Presentation): Story => ({ render: () => <AgentFixture presentation={presentation} /> });
export const PhonePortrait: Story = surface({ surface: 'phone', orientation: 'portrait' });
export const PhoneLandscape: Story = surface({ surface: 'phone', orientation: 'landscape' });
export const TabletPortrait: Story = surface({ surface: 'tablet', orientation: 'portrait' });
export const TabletLandscape: Story = surface({ surface: 'tablet', orientation: 'landscape' });
export const DesktopPortrait: Story = surface({ surface: 'desktop', orientation: 'portrait' });
export const DesktopLandscape: Story = surface({ surface: 'desktop', orientation: 'landscape' });
