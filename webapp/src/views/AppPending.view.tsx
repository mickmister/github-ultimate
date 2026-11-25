import { LoadingIndicator } from './LoadingIndicator.view';

export function AppPending() {
  return <div className="app-shell"><LoadingIndicator label="Loading GitHub Ultimate…" /></div>;
}
