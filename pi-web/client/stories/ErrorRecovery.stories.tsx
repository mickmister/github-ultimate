import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CanonicalTranscript as MessageList } from '../chat/Chat.view';
import type { ChatMessage } from '../../../hosted/pi-chat-contract';
import { conversation } from './sdk-messages';
function RecoveryStory() {
  const [broken, setBroken] = useState(false), [draft, setDraft] = useState('');
  const messages: ChatMessage[] = [
    { role: 'user', content: 'Healthy message before failure', timestamp: 1 },
    { ...conversation.find(message => message.role === 'assistant')!, content: [{ type: 'text', get text() { if (broken) throw Error('Intentional message renderer failure'); return 'Conversation is visible.'; } }] },
    { role: 'user', content: 'Healthy message after failure', timestamp: 3 },
  ];
  return <div className="chat-app"><section><button onClick={() => setBroken(true)}>Break renderer</button><button onClick={() => setBroken(false)}>Repair renderer</button><MessageList messages={messages} /><textarea aria-label="Message" value={draft} onChange={event => setDraft(event.target.value)} /></section></div>;
}
const meta = { title: 'Pi Web/Error recovery', component: RecoveryStory } satisfies Meta<typeof RecoveryStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Transcript: Story = {};
