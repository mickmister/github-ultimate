import { useEffect, useMemo, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ReviewWorkspace, type ReviewLocation } from '../src/features/reviews/ReviewWorkspace';
import { createReviewFixture, reviewScope } from './reviews.fixtures';

function Fixture({ focused = false, missingBaseline = false }: { focused?: boolean; missingBaseline?: boolean }) {
  const hooks = useMemo(() => createReviewFixture({ remote: window.location.search.includes('remoteFixture=true'), missingBaseline }), [missingBaseline]);
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => { const change = () => setHash(window.location.hash); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  const parsed = hash.startsWith('#/reviews') ? new URL(hash.slice(1), 'https://fixture.invalid') : null;
  const location: ReviewLocation = parsed ? { ...Object.fromEntries(parsed.searchParams), requestId: parsed.pathname.split('/')[2] }
    : { connection: reviewScope.connectionId, repository: reviewScope.repository, workspace: reviewScope.workspace, requestId: focused ? 'reader-01' : undefined };
  return <ReviewWorkspace key={JSON.stringify(location)} appHooks={hooks} location={location} />;
}
const meta = { title: 'Web app/Reviews', component: ReviewWorkspace, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof ReviewWorkspace>;
export default meta;
type Story = StoryObj;
export const Inbox: Story = { render: () => <Fixture /> };
export const Focused: Story = { render: () => <Fixture focused /> };
export const UnavailableBaseline: Story = { render: () => <Fixture focused missingBaseline /> };
