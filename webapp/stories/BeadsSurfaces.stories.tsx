import type { StoryObj } from '@storybook/react-vite';
import { useMemo } from 'react';
import { BeadsSample } from '../src/features/beads/BeadsSample';
import { PresentationProvider } from '../src/presentation/Presentation';
import type { Presentation } from '../src/presentation/geometry';
import type { BeadsNavigation } from '../src/features/beads/Beads.hooks';
import { pageHost } from './BeadsKanban.stories';
import { fixtureResults, fixtureIssues } from './beads.fixtures';

const navigation: BeadsNavigation = {
  read: () => new URLSearchParams({ connection: '11111111-1111-4111-8111-111111111111', repository: 'example/storage', workspace: 'first' }),
  write() {}, subscribe: () => () => {},
};
const largeHost = { ...pageHost, async open(...args: Parameters<typeof pageHost.open>) {
  const session = await pageHost.open(...args);
  const results = fixtureResults(Array.from({ length: 2000 }, (_, i) => ({ ...fixtureIssues[i % fixtureIssues.length], id: `large-${i}`, title: `Synthetic task ${i}` })));
  return { ...session, query: async (operation: Parameters<typeof session.query>[0]) => results.find(result => result.operation === operation)! };
} };
function Pilot({ value, large = false }: { value?: Presentation; large?: boolean }) {
  return <PresentationProvider value={value}><BeadsSample host={large ? largeHost : pageHost} navigation={navigation} /></PresentationProvider>;
}
export default { title: 'Web app/Beads surfaces', parameters: { layout: 'fullscreen' } };
type Story = StoryObj;
export const PhonePortrait: Story = { render: () => <Pilot value={{ surface: 'phone', orientation: 'portrait' }} /> };
export const PhoneLandscape: Story = { render: () => <Pilot value={{ surface: 'phone', orientation: 'landscape' }} /> };
export const TabletPortrait: Story = { render: () => <Pilot value={{ surface: 'tablet', orientation: 'portrait' }} /> };
export const TabletLandscape: Story = { render: () => <Pilot value={{ surface: 'tablet', orientation: 'landscape' }} /> };
export const DesktopPortrait: Story = { render: () => <Pilot value={{ surface: 'desktop', orientation: 'portrait' }} /> };
export const DesktopLandscape: Story = { render: () => <Pilot value={{ surface: 'desktop', orientation: 'landscape' }} /> };
export const Adaptive: Story = { render: () => <Pilot /> };
export const LargeAdaptive: Story = { render: () => <Pilot large /> };
function RetryPilot() {
  const host = useMemo(() => {
    let attempt = 0;
    return { ...pageHost, async open(...args: Parameters<typeof pageHost.open>) {
      if (++attempt === 1) throw new Error('Snapshot unavailable. Retry to reopen the task reader.');
      return pageHost.open(...args);
    } };
  }, []);
  return <PresentationProvider><BeadsSample host={host} navigation={navigation} /></PresentationProvider>;
}
export const Retry: Story = { render: () => <RetryPilot /> };
