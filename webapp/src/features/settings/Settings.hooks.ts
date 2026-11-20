import { useRouterState } from '@tanstack/react-router';
import { workspaceSearch } from '../navigation/navigation';
import { copy } from './Settings.copy';
import type { SettingsProps } from './contracts';
export function useSettingsFeature(): SettingsProps {
  const search = useRouterState({ select: state => state.location.search });
  const query = new URLSearchParams(workspaceSearch(search as Record<string, unknown>)).toString();
  return { appearanceHref: `#/settings/appearance${query ? `?${query}` : ''}`, diagnosticsHref: '../settings.html', build: import.meta.env.VITE_UI_BUILD ?? copy.unavailable };
}
