import type { ChatMessage } from '../../../hosted/pi-chat-contract';
import type { AssistantMessage } from '@earendil-works/pi-ai';

// Chat stories exercise the same published SDK contract as production. Renderer-
// specific historical fixtures remain separate in messages.ts for Message stories.
const assistant = {
  role: 'assistant', api: 'openai-completions', provider: 'extension', model: 'gpt-6.1-sol', timestamp: 1795485444000, stopReason: 'stop',
  usage: { input: 120, output: 84, cacheRead: 32, cacheWrite: 0, totalTokens: 236, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
} satisfies Omit<AssistantMessage, 'content'>;
export const conversation: ChatMessage[] = [
  { role: 'user', content: 'Explain the browser conversation architecture.', timestamp: 1795485443000 },
  { ...assistant, content: [{ type: 'text', text: '# Browser conversations\n\nThe **hosted frontend** owns the conversation, while the extension or native host owns authorized connections.' }] },
];
export const tools: ChatMessage[] = [
  { role: 'user', content: 'Inspect the project and show the proposed change.', timestamp: 1795485443000 },
  { ...assistant, stopReason: 'toolUse', content: [
    { type: 'thinking', thinking: 'I will inspect the relevant source before proposing a focused change.' },
    { type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: 'src/conversation.ts' } },
    { type: 'toolCall', id: 'edit-1', name: 'edit', arguments: { path: 'src/conversation.ts', oldText: 'createConversation();', newText: 'startDraft();' } },
    { type: 'toolCall', id: 'test-1', name: 'bash', arguments: { command: 'pnpm test' } },
  ] },
  { role: 'toolResult', toolCallId: 'read-1', toolName: 'read', content: [{ type: 'text', text: 'export function newConversation() {\n  createConversation();\n}' }], isError: false, timestamp: 1795485445000 },
  { role: 'toolResult', toolCallId: 'edit-1', toolName: 'edit', content: [{ type: 'text', text: 'Changed src/conversation.ts' }], isError: false, timestamp: 1795485446000 },
  { role: 'toolResult', toolCallId: 'test-1', toolName: 'bash', content: [{ type: 'text', text: 'Test failed: expected no saved conversation before first send.' }], isError: true, timestamp: 1795485447000 },
  { ...assistant, content: [{ type: 'text', text: 'The draft change is ready. The failing test above is an intentional **Storybook error-state fixture**, not a live execution.' }] },
];
