import { createHashHistory, createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  return createRouter({
    routeTree,
    basepath: '/',
    // The Pages deployment prefix belongs before #, never inside route paths.
    ...(typeof window === 'undefined' ? {} : { history: createHashHistory() }),
    scrollRestoration: true,
  });
}

declare module '@tanstack/react-router' {
  interface Register { router: ReturnType<typeof getRouter> }
}
