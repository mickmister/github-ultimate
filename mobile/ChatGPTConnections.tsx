import { useChatGPTConnections } from './ChatGPTConnections.hooks';
import { ChatGPTConnectionsView } from './ChatGPTConnections.view';
import type { MobileGrant } from '../src/mobile-protocol';
export function ChatGPTConnections({ grant }: { grant?: MobileGrant }) {
  const model = useChatGPTConnections(grant);
  return <ChatGPTConnectionsView model={model} grant={grant} />;
}
