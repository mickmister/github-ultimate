import type { ToolCall, TextContent, ImageContent } from '@earendil-works/pi-ai';
import type { ChatMessage } from '../../../hosted/pi-chat-contract';
import type { ToolCallContent } from '../lib/types';

type IsAny<T> = 0 extends (1 & T) ? true : false;
type Assert<T extends true> = T;
/** Fail the client check if an ambient stub replaces a published SDK type. */
export type PublishedTypesAreConcrete = [
  Assert<IsAny<ChatMessage> extends false ? true : false>,
  Assert<IsAny<ToolCall> extends false ? true : false>,
  Assert<IsAny<TextContent> extends false ? true : false>,
  Assert<IsAny<ImageContent> extends false ? true : false>,
];
/** The SDK and renderer formats must remain distinct across this adapter. */
export type ToolFormatsRequireConversion = Assert<ToolCall extends ToolCallContent ? false : true>;
