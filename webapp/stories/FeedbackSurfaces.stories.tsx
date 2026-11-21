import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { PresentationProvider } from '../src/presentation/Presentation';
import type { Presentation } from '../src/presentation/geometry';
import { FeedbackProvider } from '../src/features/feedback/FeedbackProvider';
import { AttachableContext } from '../src/features/feedback/AttachableContext';
import { createFeedbackQueue } from '../src/features/feedback/queue';

const target = { elementId: 'feedback-proof', label: 'Pinned document', featureId: 'feedback.proof', uiPath: ['Documents', 'Reader'], resource: { kind: 'document', id: 'proof', path: 'proof.md', revision: 'exact-revision', workspace: 'workspace-a', repository: 'owner/repository' }, representation: 'rendered-text' } as const;
function Example({ presentation }: { presentation?: Presentation }) {
  const [reviewing, setReviewing] = useState(false);
  const [queue] = useState(() => createFeedbackQueue());
  useEffect(() => {
    const navigate = () => setReviewing(location.hash === '#review');
    window.addEventListener('popstate', navigate);
    return () => window.removeEventListener('popstate', navigate);
  }, []);
  return <PresentationProvider value={presentation}><FeedbackProvider storageKey="feedback:survival" uiSuppressed={reviewing}>
    {reviewing ? <FeedbackProvider queue={queue}><AttachableContext target={{ ...target, uiPath: [...target.uiPath], label: 'Review document' }}><p>Independent review session</p></AttachableContext></FeedbackProvider> :
      <AttachableContext target={{ ...target, uiPath: [...target.uiPath] }}><p data-testid="feedback-passage">Original selected passage, unchanged by navigation.</p></AttachableContext>}
  </FeedbackProvider></PresentationProvider>;
}
export default { title: 'Web app/Feedback surfaces', component: Example } satisfies Meta<typeof Example>;
type Story = StoryObj<typeof Example>;
export const PhonePortrait: Story = { args: { presentation: { surface: 'phone', orientation: 'portrait' } } };
export const PhoneLandscape: Story = { args: { presentation: { surface: 'phone', orientation: 'landscape' } } };
export const TabletPortrait: Story = { args: { presentation: { surface: 'tablet', orientation: 'portrait' } } };
export const TabletLandscape: Story = { args: { presentation: { surface: 'tablet', orientation: 'landscape' } } };
export const DesktopPortrait: Story = { args: { presentation: { surface: 'desktop', orientation: 'portrait' } } };
export const DesktopLandscape: Story = { args: { presentation: { surface: 'desktop', orientation: 'landscape' } } };
export const Survival: Story = {};
