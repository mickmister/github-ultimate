import { useSettingsFeature } from './Settings.hooks';
import { SettingsPresentation } from './Settings.presentation';
export { Navigation } from '../navigation/Navigation';
export function Settings() {
  const props = useSettingsFeature();
  return <SettingsPresentation {...props} />;
}
