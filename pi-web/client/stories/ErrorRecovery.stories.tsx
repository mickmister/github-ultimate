import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ErrorBoundary } from '../chat/ErrorBoundary.view';

function FragileTranscript({ broken }: { broken: boolean }) {
  if (broken) throw Error('Intentional transcript renderer failure');
  return <p>Conversation is visible.</p>;
}
function RecoveryStory() {
  const [broken, setBroken] = useState(false), [draft, setDraft] = useState('');
  return <div className="chat-app"><section><button onClick={() => setBroken(true)}>Break renderer</button><button onClick={() => setBroken(false)}>Repair renderer</button><ErrorBoundary scope="conversation" retry><FragileTranscript broken={broken} /></ErrorBoundary><textarea aria-label="Message" value={draft} onChange={event => setDraft(event.target.value)} /></section></div>;
}
const meta = { title: 'Pi Web/Error recovery', component: RecoveryStory } satisfies Meta<typeof RecoveryStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Transcript: Story = {};
