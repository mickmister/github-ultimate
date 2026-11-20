import { useEffect, useMemo, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ReviewWorkspace, type ReviewLocation } from '../src/features/reviews/ReviewWorkspace';
import { ReviewProcessView } from '../src/features/reviews/ReviewProcess.view';
import { createReviewFixture, reviewScope, richComparison, type ReviewComparisonFixture } from './reviews.fixtures';
import { markdownTables } from './markdown-tables.fixtures';

function Fixture({ focused = false, missingBaseline = false, comparison, process = false, picker = false }: { focused?: boolean; missingBaseline?: boolean; comparison?: ReviewComparisonFixture; process?: boolean; picker?: boolean }) {
  const hooks = useMemo(() => createReviewFixture({ remote: window.location.search.includes('remoteFixture=true'), missingBaseline, comparison, process, picker }), [missingBaseline, comparison, process, picker]);
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => { const change = () => setHash(window.location.hash); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  const parsed = hash.startsWith('#/reviews') ? new URL(hash.slice(1), 'https://fixture.invalid') : null;
  const location: ReviewLocation = parsed ? { ...Object.fromEntries(parsed.searchParams), requestId: parsed.pathname.split('/')[2] }
    : picker ? {} : { connection: reviewScope.connectionId, repository: reviewScope.repository, workspace: reviewScope.workspace, requestId: focused ? 'reader-01' : undefined };
  return <ReviewWorkspace key={JSON.stringify(location)} appHooks={hooks} location={location} />;
}
const meta = { title: 'Web app/Reviews', component: ReviewWorkspace, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof ReviewWorkspace>;
export default meta;
type Story = StoryObj;
const configPin = { resource: 'threads/task-reader/config.md', version_kind: 'git-blob' as const, version: 'a'.repeat(40), snapshot: 'b'.repeat(40) };
const process = { kind: 'qrspi' as const, id: 'hosted-pilot', workspace_ref: 'nugs://workspace/reader-workspace', thread_id: 'threads/task-reader', config: configPin };
export const ProcessContext: Story = { render: () => <Fixture focused process /> };
export const ProcessLoading: Story = { render: () => <ReviewProcessView scope={reviewScope} process={process} loading evidence={[]} /> };
export const ProcessError: Story = { render: () => <ReviewProcessView scope={reviewScope} process={process} loading={false} evidence={[]} error="Pinned config unavailable" /> };
export const ProcessMissingCurrent: Story = { render: () => <ReviewProcessView scope={reviewScope} process={process} loading={false} evidence={[{ label: 'Historical goals', pin: configPin, metadata: 'status: approved', current: null }]} checked="2026-11-12T00:00:00Z" /> };
export const ProcessStale: Story = { render: () => <ReviewProcessView scope={reviewScope} process={process} loading={false} evidence={[{ label: 'Goals', pin: configPin, metadata: 'status: approved', current: { pin: { ...configPin, version: 'c'.repeat(40) }, metadata: 'Metadata missing; methodology position unknown' } }]} checked="2026-11-12T00:00:00Z" /> };
export const Inbox: Story = { render: () => <Fixture /> };
export const StoragePicker: Story = { render: () => <Fixture picker /> };
export const Focused: Story = { render: () => <Fixture focused /> };
export const MarkdownTables: Story = { render: () => <Fixture focused comparison={{ path: 'threads/task-reader/lifecycle.md', before: markdownTables, after: markdownTables }} /> };
export const UnavailableBaseline: Story = { render: () => <Fixture focused missingBaseline /> };
export const RichChanges: Story = { render: () => <Fixture focused comparison={richComparison} /> };
export const Unchanged: Story = { render: () => <Fixture focused comparison={{ ...richComparison, before: richComparison.after }} /> };
export const SourceChanges: Story = { render: () => <Fixture focused comparison={{ path: 'threads/task-reader/settings.json', before: '{"storage":"local"}\n', after: '{"storage":"remote"}\n' }} /> };
