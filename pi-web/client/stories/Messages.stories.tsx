import type { Meta, StoryObj } from '@storybook/react-vite';
import { Transcript } from '../chat/Chat.view';
import { conversation, tools } from './messages';
import { MessageView } from '../components/MessageView';
import { MessageContentProvider } from '../hooks/useMessageContent';

const meta = { title: 'Pi Web/Messages', component: Transcript, decorators: [(Story) => <div className="chat-app"><div className="chat-transcript"><Story /></div></div>], args: { messages: conversation } } satisfies Meta<typeof Transcript>;
export default meta;
type Story = StoryObj<typeof meta>;
export const MarkdownAndCode: Story = {};
export const ThinkingAndTools: Story = { args: { messages: tools } };
export const Streaming: Story = { args: { messages: [{ role: 'assistant', provider: 'extension', model: 'gpt-6.1-sol', content: [{ type: 'text', text: 'A reply arriving **incrementally**…' }] }], streaming: true } };
export const ProviderError: Story = { args: { messages: [{ role: 'assistant', provider: 'extension', model: 'gpt-6.1-sol', content: [], stopReason: 'error', errorMessage: 'The inference endpoint is unavailable. Please retry.' }] } };
export const DeferredHostContent: Story = { render: () => <MessageContentProvider value={{ thinking: async () => 'Full thinking supplied by the owning host.', output: async () => 'Complete output supplied by the owning host.' }}>
  <MessageView sessionId="story-session" entryId="story-entry" message={{ role: 'assistant', provider: 'extension', model: 'gpt-6.1-sol', content: [{ type: 'thinking', thinking: 'Deferred thinking preview', deferred: true }] }} />
  <MessageView sessionId="story-session" message={{ role: 'bashExecution', command: 'show example output', output: 'Truncated preview', truncated: true, fullOutputPath: 'output-reference', exitCode: 0 }} />
</MessageContentProvider> };
