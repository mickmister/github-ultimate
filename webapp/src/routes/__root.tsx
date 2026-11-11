import { ClientOnly, createRootRoute, Outlet } from '@tanstack/react-router';
import { RootDocument } from '../views/RootDocument.view';
import { AppPending } from '../views/AppPending.view';
import { FeedbackProvider } from '../features/feedback/FeedbackProvider';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Documents · GitHub Ultimate' },
    ],
  }),
  component: Root,
});

function Root() {
  // Keep the initial client tree identical to the static shell even if the
  // index route's lazy chunk resolves before React hydrates the document.
  return <RootDocument><ClientOnly fallback={<AppPending />}><FeedbackProvider><Outlet /></FeedbackProvider></ClientOnly></RootDocument>;
}
