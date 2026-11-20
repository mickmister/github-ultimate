import type { SurfaceProps } from '../../presentation/Presentation';
import type { NavigationProps } from './navigation-model';
import { copy } from './Navigation.copy';
export function NavigationDesktopView({ items, presentation }: SurfaceProps<NavigationProps>) {
  return <header className="app-navigation app-navigation-desktop" data-region="app.navigation" data-surface="desktop" data-orientation={presentation.orientation}>
    <a className="app-brand" href={items[0].href}>{copy.brand}</a><nav aria-label={copy.navigation}><ul>{items.map(item => <li key={item.key}><a href={item.href} aria-current={item.active ? 'page' : undefined}>{item.label}</a></li>)}</ul></nav>
  </header>;
}
