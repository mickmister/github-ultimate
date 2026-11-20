import { useRouterState } from '@tanstack/react-router';
import { navigationItems } from './navigation';
export function useNavigationFeature() {
  return useRouterState({ select: state => ({ items: navigationItems(state.location.pathname, state.location.search as Record<string, unknown>) }) });
}
