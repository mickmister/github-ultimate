import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  return createRouter({
    routeTree,
    // This first SPA has one index route, served by app/index.html on Pages.
    basepath: import.meta.env.BASE_URL,
    scrollRestoration: true,
  });
}

declare module '@tanstack/react-router' {
  interface Register { router: ReturnType<typeof getRouter> }
}
