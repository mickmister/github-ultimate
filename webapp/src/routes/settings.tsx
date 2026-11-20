import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router';
import { Settings } from '../features/settings/Settings';
import { workspaceSearch } from '../features/navigation/navigation-model';
export const Route = createFileRoute('/settings')({ validateSearch: workspaceSearch, component: SettingsRoute });
function SettingsRoute() {
  const child = useRouterState({ select: state => state.location.pathname.startsWith('/settings/') });
  return child ? <Outlet /> : <Settings />;
}
