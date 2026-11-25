import { expect, test } from 'vitest';
import type { AssistantMessage, ToolCall } from '@earendil-works/pi-ai';
import type { ChatMessage, ChatSnapshot } from '../hosted/pi-chat-contract';
import type { ToolCallContent as DisplayToolCall } from '../pi-web/client/lib/types';
import { displayMessage, displayMessages } from '../pi-web/client/chat/transcript-adapter';

const assistant = {
  role: 'assistant', api: 'openai-completions', provider: 'extension', model: 'model', timestamp: 1, stopReason: 'toolUse',
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
} satisfies Omit<AssistantMessage, 'content'>;
test('published SDK messages adapt without mutating canonical history', () => {
  const messages = [
    { ...assistant, content: [{ type: 'toolCall', id: 'call-1', name: 'codemode', arguments: { code: 'text("ok")' } }] },
    { role: 'toolResult', toolCallId: 'call-1', toolName: 'codemode', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: 2 },
  ] satisfies ChatMessage[];
  const before = structuredClone(messages), display = displayMessages(messages);
  expect(display[0]).toMatchObject({ content: [{ type: 'toolCall', toolCallId: 'call-1', toolName: 'codemode', input: { code: 'text("ok")' } }] });
  expect(display[1]).toEqual(messages[1]); expect(messages).toEqual(before);
});
test('streaming SDK fields and image payloads use explicit display conversions', () => {
  expect(displayMessage({ ...assistant, content: [{ type: 'toolCall', id: '', name: '', arguments: {} }] })).toMatchObject({ content: [{ toolCallId: '', toolName: 'Tool', input: {} }] });
  expect(displayMessage({ role: 'user', timestamp: 1, content: [{ type: 'image', data: 'YQ==', mimeType: 'image/png' }] })).toMatchObject({ content: [{ type: 'image', source: { type: 'base64', data: 'YQ==', media_type: 'image/png' } }] });
});

// These are compile-time regressions: an unsafe broad snapshot or SDK/render
// type alias would make @ts-expect-error unused and fail the parent typecheck.
function contractChecks(legacy: DisplayToolCall, sdk: ToolCall) {
  // @ts-expect-error Renderer fields are not canonical Pi SDK fields.
  const invalidSdk: ToolCall = legacy;
  // @ts-expect-error Canonical calls must pass through the display adapter.
  const invalidDisplay: DisplayToolCall = sdk;
  // @ts-expect-error Snapshots cannot accept arbitrary role/content objects.
  const invalidSnapshot: ChatSnapshot['messages'] = [{ role: 'assistant', content: [legacy] }];
  return { invalidSdk, invalidDisplay, invalidSnapshot };
}
void contractChecks;
