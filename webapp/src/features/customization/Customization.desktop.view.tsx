import type { SurfaceProps } from '../../presentation/Presentation';
import type { CustomizationProps } from './contracts';
import { AppearanceHeader, AppearanceFeedback, ThemeBasics, ThemeGroups, ThemeAdvanced, AppearancePreview, AppearanceActions, AppearanceSections } from './Customization.view';
export function CustomizationDesktopView({ model, presentation }: SurfaceProps<CustomizationProps>) {
  return <main className="appearance-page appearance-desktop" data-surface="desktop" data-orientation={presentation.orientation}>
    <AppearanceHeader model={model} /><AppearanceFeedback model={model} />
    <div className="appearance-desktop-workspace"><AppearanceSections model={model} /><div className="appearance-editor"><ThemeBasics model={model} /><ThemeGroups model={model} /><ThemeAdvanced model={model} /></div><AppearancePreview model={model} /></div>
    <AppearanceActions model={model} />
  </main>;
}
