import type { AgentMessage } from '../lib/types';

// Storybook-only data. Production entrypoints never import this module.
export const conversation: AgentMessage[] = [
  { role: 'user', content: 'Explain the browser conversation architecture.', timestamp: 1795485443000 },
  { role: 'assistant', model: 'gpt-6.1-sol', provider: 'extension', timestamp: 1795485444000, stopReason: 'stop', content: [{ type: 'text', text: '# Browser conversations\n\nThe **hosted frontend** owns the conversation, while the extension or native host owns authorized connections.\n\n| Layer | Responsibility |\n| --- | --- |\n| Pi agent | Conversation and tool loop |\n| Host | Credentials and network access |\n| S3 | Immutable history |\n\n```typescript\nawait chat.send("Hello Pi");\n```\n\nEach conversation has one sidebar entry. Checkpoints remain internal history.' }], usage: { input: 120, output: 84, cacheRead: 32, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
];
export const tools: AgentMessage[] = [
  { role: 'user', content: 'Inspect the project and show the proposed change.', timestamp: 1795485443000 },
  { role: 'assistant', model: 'gpt-6.1-sol', provider: 'extension', timestamp: 1795485444000, content: [
    { type: 'thinking', thinking: 'I will inspect the relevant source before proposing a focused change.' },
    { type: 'toolCall', toolCallId: 'read-1', toolName: 'read', input: { path: 'src/conversation.ts' } },
    { type: 'toolCall', toolCallId: 'edit-1', toolName: 'edit', input: { path: 'src/conversation.ts', oldText: 'createConversation();', newText: 'startDraft();' } },
    { type: 'toolCall', toolCallId: 'test-1', toolName: 'bash', input: { command: 'pnpm test' } },
  ] },
  { role: 'toolResult', toolCallId: 'read-1', toolName: 'read', content: [{ type: 'text', text: 'export function newConversation() {\n  createConversation();\n}' }], timestamp: 1795485445000 },
  { role: 'toolResult', toolCallId: 'edit-1', toolName: 'edit', content: [{ type: 'text', text: 'Changed src/conversation.ts' }], timestamp: 1795485446000 },
  { role: 'toolResult', toolCallId: 'test-1', toolName: 'bash', content: [{ type: 'text', text: 'Test failed: expected no saved conversation before first send.' }], isError: true, timestamp: 1795485447000 },
  { role: 'assistant', model: 'gpt-6.1-sol', provider: 'extension', timestamp: 1795485448000, content: [{ type: 'text', text: 'The draft change is ready. The failing test above is an intentional **Storybook error-state fixture**, not a live execution.' }] },
];
