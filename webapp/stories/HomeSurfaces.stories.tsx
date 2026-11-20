import { useMemo } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Home } from '../src/features/home/Home';
import type { AppHooksV1 } from '../src/app-hooks/contracts';
import { PresentationProvider } from '../src/presentation/Presentation';
import type { Presentation } from '../src/presentation/geometry';
import { createReviewFixture } from './reviews.fixtures';

function Fixture({ presentation, manual = false }: { presentation?: Presentation; manual?: boolean }) {
  const hooks = useMemo<AppHooksV1>(() => {
    const base = createReviewFixture();
    const remote = window.location.search.includes('remoteFixture=true');
    const check = async (operation: string, source: string) => {
      if (!remote) return;
      const response = await fetch('/__home-fixture', { headers: { 'X-Home-Operation': operation, 'X-Home-Source': source } });
      if (!response.ok) throw new Error(await response.text());
    };
    return { contractVersion: 1, modules: {
      documents: { ...base.modules.documents,
        connect: async () => [{ id: 'one', installationId: 1, name: 'Personal', account: 'alice' }, { id: 'two', installationId: 2, name: 'Team', account: 'team' }],
        repositories: manual ? undefined : async connection => { await check('repositories', connection); return [{ fullName: 'example/reviews', private: true }]; },
        discover: async scope => { await check('discover', scope.connectionId); return [{ id: 'alpha', hasDocuments: true }, { id: 'beta', hasDocuments: true }]; },
        open: async () => { await check('forbidden-body', 'documents.open'); throw Error('Unexpected snapshot open'); },
        read: async () => { await check('forbidden-body', 'documents.read'); throw Error('Unexpected body read'); },
      },
      reviews: { ...base.modules.reviews!,
        async list(scope) {
          await check('list', `${scope.connectionId}/${scope.workspace}`);
          const listing = await base.modules.reviews!.list(scope);
          return { ...listing, requests: listing.requests.map((review, index) => ({ ...review, request: { ...review.request, workspace: scope.workspace, status: index ? 'draft' : 'published', title: `${scope.connectionId} ${scope.workspace} ${index ? 'draft' : 'review'}` } })) };
        },
        read: async () => { await check('forbidden-body', 'reviews.read'); throw Error('Unexpected member read'); },
        open: async () => { await check('forbidden-body', 'reviews.open'); throw Error('Unexpected request open'); },
      },
    } };
  }, [manual]);
  return <PresentationProvider value={presentation}><Home appHooks={hooks} /></PresentationProvider>;
}
const meta = { title: 'Web app/Home surfaces', component: Home, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof Home>;
export default meta;
type Story = StoryObj;
export const PhonePortrait: Story = { render: () => <Fixture presentation={{ surface: 'phone', orientation: 'portrait' }} /> };
export const PhoneLandscape: Story = { render: () => <Fixture presentation={{ surface: 'phone', orientation: 'landscape' }} /> };
export const TabletPortrait: Story = { render: () => <Fixture presentation={{ surface: 'tablet', orientation: 'portrait' }} /> };
export const TabletLandscape: Story = { render: () => <Fixture presentation={{ surface: 'tablet', orientation: 'landscape' }} /> };
export const DesktopPortrait: Story = { render: () => <Fixture presentation={{ surface: 'desktop', orientation: 'portrait' }} /> };
export const DesktopLandscape: Story = { render: () => <Fixture presentation={{ surface: 'desktop', orientation: 'landscape' }} /> };
export const Adaptive: Story = { render: () => <Fixture /> };
export const ManualRepository: Story = { render: () => <Fixture manual /> };
