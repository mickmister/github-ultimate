import type { SurfaceProps } from '../../presentation/Presentation';
import type { SettingsProps } from './contracts';
import { AppSettingsView } from '../../views/AppSettings.view';
import { copy } from './Settings.copy';
export function SettingsDesktopView({ appearanceHref, diagnosticsHref, build, presentation }: SurfaceProps<SettingsProps>) {
  return <main className="settings-page settings-desktop" data-surface="desktop" data-orientation={presentation.orientation}>
    <header><h1>{copy.title}</h1><a className="settings-destination" href={appearanceHref}>{copy.appearance}</a></header>
    <div className="settings-columns"><section className="settings-card"><h2>{copy.connections}</h2><a href={diagnosticsHref}>{copy.diagnostics}</a></section><AppSettingsView build={build} /></div>
  </main>;
}
