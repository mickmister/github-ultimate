import type { Meta, StoryObj } from '@storybook/html-vite';
import { form, json } from './fixtures';
import { baseArgs, controls, renderRecord, type StoryArgs } from './render';

const meta = { title: 'Fallbacks', render: renderRecord, argTypes: controls, args: { ...baseArgs, source: json({ ...form, workflow: 'untrusted-action.yml' }) } } satisfies Meta<StoryArgs>;
export default meta;
type Story = StoryObj<StoryArgs>;

export const UnsupportedField: Story = {};
export const UnsupportedVersion: Story = { args: { source: json({ ...form, version: 99 }) } };
export const MalformedJson: Story = { args: { source: '{ "format": "standard", "questions": [' } };
export const UnsafeMarkdown: Story = { args: { source: json({ ...form, description: '<img src=x onerror="alert(1)"><script>alert(1)</script>\n\n[Unsafe link](javascript:alert(1))\n\n**Safe Markdown remains readable.**' }) } };
