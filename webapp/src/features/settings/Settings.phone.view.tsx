import type { SurfaceProps } from '../../presentation/Presentation';
import type { SettingsProps } from './contracts';
import { AppSettingsView } from '../../views/AppSettings.view';
import { copy } from './Settings.copy';
export function SettingsPhoneView({ appearanceHref, diagnosticsHref, build, presentation }: SurfaceProps<SettingsProps>) {
  return <main className="settings-page settings-phone" data-surface="phone" data-orientation={presentation.orientation}>
    <h1>{copy.title}</h1><a className="settings-destination" href={appearanceHref}>{copy.appearance}</a>
    <section className="settings-card"><h2>{copy.connections}</h2><a href={diagnosticsHref}>{copy.diagnostics}</a></section><AppSettingsView build={build} />
  </main>;
}
