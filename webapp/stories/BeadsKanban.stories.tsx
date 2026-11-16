import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { BeadsBoard } from '../src/features/beads/BeadsBoard';
import { fixtureIssues, fixtureResults } from './beads.fixtures';

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
  return <><button onClick={() => setSecond(value => !value)}>Switch workspace</button><BeadsBoard key={String(second)} workspace={second ? 'Second workspace' : 'First workspace'} results={fixtureResults(second ? [{ id: 'second-1', title: 'A different collection', status: 'open', priority: 2 }] : fixtureIssues)} /></>;
}
export const WorkspaceSwitch: Story = { render: () => <SwitchingWorkspace />, args: Compact.args };
