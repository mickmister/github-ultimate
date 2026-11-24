import type { AgentMessage, AssistantContentBlock, ImageContent, TextContent } from '../lib/types';

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function content(value: unknown): AssistantContentBlock[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((block): AssistantContentBlock[] => {
    if (!record(block)) return [];
    if (block.type === 'text' && typeof block.text === 'string') return [{ type: 'text', text: block.text }];
    if (block.type === 'thinking' && typeof block.thinking === 'string') return [{ type: 'thinking', thinking: block.thinking }];
    if (block.type === 'image') {
      if (record(block.source) && (block.source.type === 'base64' || block.source.type === 'url')) return [block as unknown as ImageContent];
      if (typeof block.data === 'string' && typeof block.mimeType === 'string') return [{ type: 'image', source: { type: 'base64', data: block.data, media_type: block.mimeType } }];
    }
    if (block.type === 'toolCall') return [{
      type: 'toolCall',
      toolCallId: typeof block.id === 'string' ? block.id : typeof block.toolCallId === 'string' ? block.toolCallId : '',
      toolName: typeof block.name === 'string' ? block.name : typeof block.toolName === 'string' ? block.toolName : 'Tool',
      input: record(block.arguments) ? block.arguments : record(block.input) ? block.input : {},
      ...(typeof block.rawInput === 'string' ? { rawInput: block.rawInput } : {}),
    }];
    return [];
  });
}
const plain = (value: unknown) => content(value).filter((block): block is TextContent | ImageContent => block.type === 'text' || block.type === 'image');

/** Pi SDK messages remain canonical in storage. Adapt only for the imported
 * coding-agent renderer, whose tool fields use a different wire format. */
export function displayMessages(messages: readonly { role: string; content?: unknown }[]): AgentMessage[] {
  return messages.flatMap((value): AgentMessage[] => {
    const message = value as unknown as Record<string, unknown>;
    if (message.role === 'user') return [{ ...message, role: 'user', content: typeof message.content === 'string' ? message.content : plain(message.content) }];
    if (message.role === 'assistant') return [{ ...message, role: 'assistant', model: typeof message.model === 'string' ? message.model : '', provider: typeof message.provider === 'string' ? message.provider : '', content: content(message.content) }];
    if (message.role === 'toolResult' && typeof message.toolCallId === 'string') return [{ ...message, role: 'toolResult', toolCallId: message.toolCallId, content: plain(message.content) }];
    return [];
  });
}
