import { copy } from '../features/settings/Settings.copy';
import type { ReactNode } from 'react';
export function AppFrameView({ navigation, children }: { navigation: ReactNode; children: ReactNode }) {
  return <div className="application-frame">{navigation}<div className="application-content">{children}</div></div>;
}
export function AppSettingsView({ build }: { build: string }) {
  return <details id="settings-about" className="settings-card app-settings">
    <summary>{copy.about}</summary>
    <dl><dt>{copy.app}</dt><dd><span>{copy.build}</span> <code>{build}</code></dd></dl><p>{copy.native}</p>
  </details>;
}
