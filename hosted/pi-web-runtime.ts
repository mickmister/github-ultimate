import { Agent } from '@earendil-works/pi-agent-core';
import { bridgeRequest } from './client';
import { inferenceStream, piModel } from './pi-transport';
import type { PublicInferenceConnection } from '../src/inference-protocol';

// Loaded as a separate browser bundle so the upstream demo keeps its independent
// npm graph. No endpoint, header or provider credential enters the Pi Web page.
window.piWebExtension = {
  connections: () => bridgeRequest<PublicInferenceConnection[]>({ operation: 'inferenceConnections' }),
  create(connection: PublicInferenceConnection) {
    const agent = new Agent({
      initialState: {
        systemPrompt: 'You are Pi, running in the browser. Answer the user using this conversation. No filesystem, shell or other tools are available in this session.',
        model: piModel(connection), thinkingLevel: 'off', tools: [],
      },
      streamFn: inferenceStream(bridgeRequest, connection),
      finishTurn: () => ({ action: 'end' }),
    });
    return {
      systemPrompt: agent.state.systemPrompt,
      prompt: (text: string) => agent.prompt(text),
      abort: () => agent.abort(),
      subscribe: (listener: (event: unknown) => void) => agent.subscribe(listener),
    };
  },
};

declare global {
  interface Window { piWebExtension: {
    connections(): Promise<PublicInferenceConnection[]>;
    create(connection: PublicInferenceConnection): {
      systemPrompt: string;
      prompt(text: string): Promise<void>; abort(): void;
      subscribe(listener: (event: unknown) => void): () => void;
    };
  } }
}
