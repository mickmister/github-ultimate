import type { Meta, StoryObj } from '@storybook/html-vite';
import { form, filled, json } from './fixtures';
import { baseArgs, controls, renderRecord, type StoryArgs } from './render';

const meta = { title: 'GitHub conversation', render: renderRecord, argTypes: controls, args: { ...baseArgs, source: json(form) } } satisfies Meta<StoryArgs>;
export default meta;
type Story = StoryObj<StoryArgs>;

export const PullRequest: Story = {};
export const ReviewAndCompose: Story = { args: { seed: filled, stage: 'preview' } };
export const PostedResponses: Story = { args: { seed: filled, stage: 'history' } };
export const Issue: Story = { args: { thread: 'issue', source: json({ ...form, title: 'Clarify this issue before implementing', allowCodeFileChanges: false }) } };
export const LongConversation: Story = { args: { conversation: 'long' } };
export const WorkspacePanel: Story = { args: { workspaceOpen: true } };
export const MobileDark: Story = { args: { width: 'phone', theme: 'dark', seed: filled } };
export const IsolatedRenderer: Story = { args: { layout: 'isolated', seed: filled } };
