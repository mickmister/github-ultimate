import type { AssistantMessage, ImageContent, TextContent, ThinkingContent, ToolCall } from '@earendil-works/pi-ai';
import type { ChatMessage } from '../../../hosted/pi-chat-contract';
import type { AgentMessage as DisplayMessage, AssistantContentBlock, ImageContent as DisplayImage, ToolResultMessage as DisplayResult } from '../lib/types';

function unreachable(value: never): never { throw Error(`Unsupported Pi transcript variant: ${JSON.stringify(value)}`); }
function plain(block: TextContent | ImageContent): TextContent | DisplayImage {
  switch (block.type) {
    case 'text': return block;
    case 'image': return { type: 'image', source: { type: 'base64', data: block.data, media_type: block.mimeType } };
    default: return unreachable(block);
  }
}
/** The renderer's tool fields are a presentation format, never an SDK type. */
function content(block: TextContent | ThinkingContent | ToolCall): AssistantContentBlock {
  switch (block.type) {
    case 'text': case 'thinking': return block;
    case 'toolCall': return { type: 'toolCall', toolCallId: block.id, toolName: block.name || 'Tool', input: block.arguments };
    default: return unreachable(block);
  }
}
// Keep this indexed by the published assistant union so new block variants fail
// typechecking at the exhaustive conversion above, rather than being discarded.
const assistantContent = (blocks: AssistantMessage['content']) => blocks.map(content);
export function displayMessage(message: Extract<ChatMessage, { role: 'toolResult' }>): DisplayResult;
export function displayMessage(message: ChatMessage): DisplayMessage;
export function displayMessage(message: ChatMessage): DisplayMessage {
  switch (message.role) {
    case 'user': return { ...message, content: typeof message.content === 'string' ? message.content : message.content.map(plain) };
    case 'assistant': return { ...message, content: assistantContent(message.content) };
    case 'toolResult': return { ...message, content: message.content.map(plain) };
    default: return unreachable(message);
  }
}
export const displayMessages = (messages: readonly ChatMessage[]): DisplayMessage[] => messages.map(message => displayMessage(message));
