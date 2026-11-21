import type { SurfaceProps } from '../../presentation/Presentation';
import type { CustomizationProps } from './contracts';
import { AppearanceHeader, AppearanceFeedback, ThemeBasics, ThemeGroups, ThemeAdvanced, AppearancePreview, AppearanceActions } from './Customization.view';
export function CustomizationTabletView({ model, presentation }: SurfaceProps<CustomizationProps>) {
  return <main className="appearance-page appearance-tablet" data-surface="tablet" data-orientation={presentation.orientation}>
    <AppearanceHeader model={model} /><AppearanceFeedback model={model} /><ThemeBasics model={model} />
    <div className="appearance-tablet-workspace"><div className="appearance-editor"><ThemeGroups model={model} /><ThemeAdvanced model={model} /></div><AppearancePreview model={model} /></div>
    <AppearanceActions model={model} />
  </main>;
}
