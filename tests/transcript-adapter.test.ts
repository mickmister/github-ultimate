import { expect, test } from 'vitest';
import { displayMessages } from '../pi-web/client/chat/transcript-adapter';

test('adapts real SDK tool call fields without mutating canonical history', () => {
  const messages = [{ role: 'assistant', model: 'model', provider: 'extension', content: [{ type: 'toolCall', id: 'call-1', name: 'codemode', arguments: { code: 'text("ok")' } }] }, { role: 'toolResult', toolCallId: 'call-1', toolName: 'codemode', content: [{ type: 'text', text: 'ok' }], isError: false }];
  const before = structuredClone(messages), display = displayMessages(messages);
  expect(display[0]).toMatchObject({ content: [{ type: 'toolCall', toolCallId: 'call-1', toolName: 'codemode', input: { code: 'text("ok")' } }] });
  expect(display[1]).toEqual(messages[1]); expect(messages).toEqual(before);
});
test('partial streamed calls and imported renderer fixtures are displayable', () => {
  expect(displayMessages([{ role: 'assistant', content: [{ type: 'toolCall', id: 'partial' }] }])[0]).toMatchObject({ model: '', provider: '', content: [{ toolCallId: 'partial', toolName: 'Tool', input: {} }] });
  const legacy = { role: 'assistant', content: [{ type: 'toolCall', toolCallId: 'legacy', toolName: 'read', input: { path: 'file' } }] };
  expect(displayMessages([legacy])[0]).toMatchObject({ content: legacy.content });
});
