import type { Meta, StoryObj } from '@storybook/html-vite';
import { snapshot, json } from './fixtures';
import { baseArgs, controls, renderRecord, type StoryArgs } from './render';

const meta = { title: 'Workflow snapshots', render: renderRecord, argTypes: controls, args: { ...baseArgs, source: json(snapshot) } } satisfies Meta<StoryArgs>;
export default meta;
type Story = StoryObj<StoryArgs>;

export const Submitted: Story = { args: { source: json({ ...snapshot, status: 'submitted' }) } };
export const Queued: Story = { args: { source: json({ ...snapshot, status: 'queued' }) } };
export const Running: Story = {};
export const NeedsInput: Story = { args: { source: json({ ...snapshot, status: 'needs-input', beads: [{ id: 'demo.1', title: 'Choose how to proceed', status: 'blocked' }] }) } };
export const ReadyForReview: Story = { args: { source: json({ ...snapshot, status: 'ready-for-review', summary: 'The patch and checks are ready for human review.' }) } };
export const Failed: Story = { args: { source: json({ ...snapshot, status: 'failed', summary: 'A verification step failed. This saved snapshot retains the last known progress.' }) } };
export const Cancelled: Story = { args: { source: json({ ...snapshot, status: 'cancelled' }) } };
export const Done: Story = { args: { source: json({ ...snapshot, status: 'done', beads: snapshot.beads.map(bead => ({ ...bead, status: 'closed' })) }) } };
export const StaleOffline: Story = { args: { source: json({ ...snapshot, updated_at: '2020-01-01T00:00:00Z', dashboard_status: 'offline' }) } };
export const NoBeads: Story = { args: { source: json({ ...snapshot, beads: [] }) } };
export const DarkPhone: Story = { args: { theme: 'dark', width: 'phone' } };
export const UnavailableLinks: Story = { args: { source: json({ ...snapshot, run_url: 'https://github.com/unrelated/repository/actions/runs/42', dashboard_url: 'https://example.com/' }) } };
