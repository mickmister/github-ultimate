import type { SurfaceProps } from '../../presentation/Presentation';
import type { CustomizationProps } from './contracts';
import { AppearanceHeader, AppearanceFeedback, ThemeBasics, ThemeGroups, ThemeAdvanced, AppearancePreview, AppearanceActions } from './Customization.view';
export function CustomizationPhoneView({ model, presentation }: SurfaceProps<CustomizationProps>) {
  return <main className="appearance-page appearance-phone" data-surface="phone" data-orientation={presentation.orientation}>
    <AppearanceHeader model={model} /><AppearanceFeedback model={model} />
    <ThemeBasics model={model} /><ThemeGroups model={model} /><ThemeAdvanced model={model} />
    <AppearancePreview model={model} /><AppearanceActions model={model} />
  </main>;
}
