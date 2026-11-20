import type { SurfaceProps } from '../../presentation/Presentation';
import type { NavigationProps } from './navigation-model';
import { copy } from './Navigation.copy';
export function NavigationTabletView({ items, presentation }: SurfaceProps<NavigationProps>) {
  return <aside className="app-navigation app-navigation-tablet" data-region="app.navigation" data-surface="tablet" data-orientation={presentation.orientation}>
    <a className="app-brand" href={items[0].href}>{copy.brand}</a><nav aria-label={copy.navigation}>{items.map(item => <a key={item.key} href={item.href} aria-current={item.active ? 'page' : undefined}>{item.label}</a>)}</nav>
  </aside>;
}
