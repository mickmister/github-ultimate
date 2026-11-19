import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, Context, Message, Model, Tool } from '@earendil-works/pi-ai';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { z } from 'zod';
import type { HostedRequest } from '../src/hosted-protocol';
import type { PublicInferenceConnection } from '../src/inference-protocol';

export type PiBridge = <T>(request: HostedRequest, timeoutMs?: number) => Promise<T>;
export const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
export function piModel(connection: PublicInferenceConnection): Model<'openai-completions'> {
  return { id: connection.model, name: connection.model, api: 'openai-completions', provider: 'extension', baseUrl: 'https://extension.invalid', reasoning: false, input: ['text'], contextWindow: 32768, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
}
function text(content: Message['content']): string {
  if (typeof content === 'string') return content;
  if (content.some(part => part.type !== 'text' && part.type !== 'toolCall')) throw new Error('This POC supports text and tool calls only.');
  return content.filter(part => part.type === 'text').map(part => part.text).join('\n');
}
/** Explicit text/tool subset. Reject unsupported system updates rather than lose instructions. */
export function completionBody(context: Context) {
  const tools = new Map<string, Tool>((context.tools ?? []).map(tool => [tool.name, tool]));
  const messages: unknown[] = context.systemPrompt ? [{ role: 'system', content: context.systemPrompt }] : [];
  for (const message of context.messages) {
    if (message.role === 'system') {
      if (message.sections || message.toolsRemoved?.length) throw new Error('Dynamic system sections/tool removals are not supported in this POC.');
      for (const tool of message.toolsAdded ?? []) tools.set(tool.name, tool);
      if (text(message.content)) messages.push({ role: 'system', content: text(message.content) });
    } else if (message.role === 'toolResult') messages.push({ role: 'tool', tool_call_id: message.toolCallId, content: text(message.content) });
    else if (message.role === 'assistant') {
      if (!message.content.length && (message.stopReason === 'error' || message.stopReason === 'aborted')) continue;
      const calls = message.content.filter(part => part.type === 'toolCall');
      messages.push({ role: 'assistant', content: text(message.content) || null, ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } : {}) });
    } else messages.push({ role: 'user', content: text(message.content) });
  }
  return { messages, ...(tools.size ? { tools: [...tools.values()].map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) } : {}) };
}
const responseSchema = z.object({ choices: z.array(z.object({ finish_reason: z.enum(['stop', 'tool_calls', 'length']), message: z.object({
  content: z.string().nullable().optional(), refusal: z.string().nullable().optional(),
  tool_calls: z.array(z.object({ id: z.string().min(1).max(200), type: z.literal('function'), function: z.object({ name: z.string().min(1).max(100), arguments: z.string().max(65536) }) })).max(16).optional(),
}) })).length(1), usage: z.object({ prompt_tokens: z.number().nonnegative(), completion_tokens: z.number().nonnegative(), total_tokens: z.number().nonnegative() }).optional() });

/** Pi's stream contract over a single bounded JSON bridge reply. No tokens or endpoint in page memory. */
export function inferenceStream(bridge: PiBridge, connection: PublicInferenceConnection): StreamFn {
  return (model, context, options) => {
    const stream = new AssistantMessageEventStream(), requestId = crypto.randomUUID();
    const message: AssistantMessage = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, usage: emptyUsage(), stopReason: 'stop', timestamp: Date.now() };
    const cancel = () => { void bridge({ operation: 'inferenceCancel', id: connection.id, revision: connection.revision, requestId }).catch(() => {}); };
    void (async () => {
      try {
        options?.signal?.throwIfAborted();
        options?.signal?.addEventListener('abort', cancel, { once: true });
        const reply = responseSchema.parse(await bridge({ operation: 'inferenceComplete', id: connection.id, revision: connection.revision, requestId, body: JSON.stringify(completionBody(context)) }, 100000));
        options?.signal?.throwIfAborted();
        const choice = reply.choices[0], content = choice.message;
        if (content.refusal) throw new Error('The inference provider declined this request.');
        if (content.content) message.content.push({ type: 'text', text: content.content });
        for (const call of content.tool_calls ?? []) {
          const args = JSON.parse(call.function.arguments);
          if (!args || Array.isArray(args) || typeof args !== 'object') throw new Error('Invalid tool arguments.');
          message.content.push({ type: 'toolCall', id: call.id, name: call.function.name, arguments: args });
        }
        if (!message.content.length || new Set((content.tool_calls ?? []).map(call => call.id)).size !== (content.tool_calls ?? []).length) throw new Error('Empty response or duplicate tool call IDs.');
        if (choice.finish_reason === 'tool_calls' && !content.tool_calls?.length) throw new Error('The provider reported tool calls without any calls.');
        if (choice.finish_reason === 'length' && content.tool_calls?.length) throw new Error('Truncated tool calls cannot be executed.');
        message.stopReason = content.tool_calls?.length ? 'toolUse' : choice.finish_reason === 'length' ? 'length' : 'stop';
        if (reply.usage) Object.assign(message.usage, { input: reply.usage.prompt_tokens, output: reply.usage.completion_tokens, totalTokens: reply.usage.total_tokens });
        stream.push({ type: 'start', partial: message });
        stream.push({ type: 'done', reason: message.stopReason, message });
      } catch (error) {
        message.content = []; message.stopReason = options?.signal?.aborted ? 'aborted' : 'error';
        message.errorMessage = error instanceof Error && !(error instanceof z.ZodError) ? error.message : 'Invalid inference response.';
        stream.push({ type: 'error', reason: message.stopReason, error: message });
      } finally { options?.signal?.removeEventListener('abort', cancel); stream.end(message); }
    })();
    return stream;
  };
}
