import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { BeadsBoard } from '../src/features/beads/BeadsBoard';
import { fixtureIssues, fixtureResults } from './beads.fixtures';
import { BeadsSample } from '../src/features/beads/BeadsSample';
import { applicationStorage } from '../src/app-storage';
import type { ComponentProps } from 'react';

const meta = { title: 'Web app/Beads Kanban', component: BeadsBoard, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof BeadsBoard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Compact: Story = { args: { results: fixtureResults(), workspace: 'Example workspace · mock snapshot' } };
export const Comfortable: Story = { args: { ...Compact.args, initialDensity: 'comfortable' } };
export const Empty: Story = { args: { ...Compact.args, results: fixtureResults([]) } };
export const ChooseWorkspace: Story = { args: { results: [], workspace: '' } };
export const ReadinessUnavailable: Story = { args: { ...Compact.args, results: fixtureResults().slice(0, 1) } };
export const LongTitles: Story = { args: { ...Compact.args, results: fixtureResults(fixtureIssues.map(issue => ({ ...issue, title: `${issue.title} — ${'A long task title should remain readable on a narrow screen. '.repeat(5)}` }))) } };
export const LargeWorkspace: Story = { args: { ...Compact.args, results: fixtureResults(Array.from({ length: 1000 }, (_, i) => ({ ...fixtureIssues[i % 5], id: `large-${i}`, title: `Synthetic task ${i}`, priority: i % 5 }))) } };
export const InvalidSnapshot: Story = { args: { ...Compact.args, results: fixtureResults([fixtureIssues[0], fixtureIssues[0]]) } };
function SwitchingWorkspace() {
  const [second, setSecond] = useState(false);
  return <><button onClick={() => setSecond(value => !value)}>Switch workspace</button><BeadsBoard workspace={second ? 'Second workspace' : 'First workspace'} results={fixtureResults(second ? [{ id: 'second-1', title: 'A different collection', status: 'open', priority: 2 }] : fixtureIssues)} /></>;
}
export const WorkspaceSwitch: Story = { render: () => <SwitchingWorkspace />, args: Compact.args };

export const pageHost: NonNullable<ComponentProps<typeof BeadsSample>['host']> = {
  connections: async () => [{ id: '11111111-1111-4111-8111-111111111111', appId: 1, name: 'Example connection', installation: { id: 1, account: 'example' } }],
  discover: async () => ['first', 'second'], storage: applicationStorage,
  async open(scope, signal) {
    signal.throwIfAborted();
    const results = fixtureResults(scope.workspace === 'second' ? [{ id: 'second-1', title: 'A different collection', status: 'open', priority: 2 }] : fixtureIssues);
    return { gitCommit: 'example-git', doltCommit: 'example-dolt', root: 'example-root', storageRoot: 'example-storage', fileCount: 1, encodedBytes: 100,
      query: async operation => results.find(result => result.operation === operation)!,
      state: async () => ({ putRejected: true, commitRejected: true, sealed: true, heapAllocBytes: 1, heapSysBytes: 1 }), dispose() {},
    };
  },
};
export const RememberedWorkspace: Story = { render: () => <BeadsSample host={pageHost} />, args: Compact.args };
const unavailableHost = { ...pageHost, connections: async () => [] };
export const RemovedConnection: Story = { render: () => <BeadsSample host={unavailableHost} />, args: Compact.args };
