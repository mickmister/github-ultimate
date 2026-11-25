import type { Meta, StoryObj } from '@storybook/html-vite';
import { response, json } from './fixtures';
import { baseArgs, controls, renderRecord, type StoryArgs } from './render';

const meta = { title: 'Responses', render: renderRecord, argTypes: controls, args: { ...baseArgs, source: json(response()) } } satisfies Meta<StoryArgs>;
export default meta;
type Story = StoryObj<StoryArgs>;

export const Discussion: Story = {};
export const Approved: Story = { args: { source: json(response(undefined, true)) } };
export const NewSession: Story = { args: { source: json({ ...response(), session_id: null, resume_session: false }) } };
export const OtherExplanation: Story = { args: { source: json(response({ approach: { other: true }, approach_other_more_info: 'A different approach with a full explanation.' })) } };
export const DarkPhone: Story = { args: { theme: 'dark', width: 'phone' } };
