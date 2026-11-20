import type { SurfaceProps } from '../../presentation/Presentation';
import type { SettingsProps } from './contracts';
import { AppSettingsView } from '../../views/AppSettings.view';
import { copy } from './Settings.copy';
export function SettingsTabletView({ appearanceHref, diagnosticsHref, build, presentation }: SurfaceProps<SettingsProps>) {
  return <main className="settings-page settings-tablet" data-surface="tablet" data-orientation={presentation.orientation}>
    <header><h1>{copy.title}</h1></header><div className="settings-master-detail"><nav aria-label={copy.title}><a className="settings-destination" href={appearanceHref}>{copy.appearance}</a></nav>
      <div><section id="settings-connections" className="settings-card"><h2>{copy.connections}</h2><a href={diagnosticsHref}>{copy.diagnostics}</a></section><AppSettingsView build={build} /></div></div>
  </main>;
}
