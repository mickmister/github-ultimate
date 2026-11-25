import { useNavigationFeature } from './Navigation.hooks';
import { NavigationPresentation } from './Navigation.presentation';
export function Navigation() {
  const props = useNavigationFeature();
  return <NavigationPresentation {...props} />;
}
