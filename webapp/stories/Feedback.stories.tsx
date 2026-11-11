import type { Meta, StoryObj } from '@storybook/react-vite';
import { FeedbackProvider } from '../src/features/feedback/FeedbackProvider';
import { AttachableContext } from '../src/features/feedback/AttachableContext';
import { FeedbackAnnotations } from '../src/features/feedback/FeedbackAnnotations';
import { MarkdownDocument } from '../src/features/documents/MarkdownDocument';
import { documentFeedbackTarget } from '../src/features/documents/feedback-target';
import { mockDocumentContents, mockSnapshot, readyModel } from './documents.fixtures';

const meta = { title: 'Web app/Feedback', component: AttachableContext, parameters: { layout: 'padded' } } satisfies Meta<typeof AttachableContext>;
export default meta;
type Story = StoryObj;

// Real feedback and document-rendering components, with a nested UI boundary.
function FeedbackExample({ includePageUrl = false }: { includePageUrl?: boolean }) {
  return <FeedbackProvider includePageUrl={includePageUrl} storageKey={includePageUrl ? 'feedback:url-opt-in-demo:v1' : undefined}>
  <AttachableContext target={{ elementId: 'documents', label: 'document browser', uiPath: ['Documents'], featureId: 'documents.browser' }}>
    <AttachableContext target={{ ...documentFeedbackTarget(readyModel, mockSnapshot.documents[0], 'documents.markdown-renderer', 'rendered-markdown'), uiPath: ['Reader'] }}>
      <FeedbackAnnotations target={documentFeedbackTarget(readyModel, mockSnapshot.documents[0], 'documents.markdown-renderer', 'rendered-markdown')}><MarkdownDocument content={mockDocumentContents.brief} /></FeedbackAnnotations>
    </AttachableContext>
  </AttachableContext>
</FeedbackProvider>;
}
export const NestedTargets: Story = { render: () => <FeedbackExample /> };
export const UrlOptIn: Story = { render: () => <FeedbackExample includePageUrl /> };
export const InlineComments: Story = { render: () => <FeedbackExample />, parameters: { docs: { description: { story: 'Select a passage and add a content or feature comment. Queued comments highlight the passage and appear beside it; edit or delete from either the document or the queue.' } } } };
