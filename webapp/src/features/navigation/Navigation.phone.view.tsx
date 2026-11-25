import type { SurfaceProps } from '../../presentation/Presentation';
import type { NavigationProps } from './navigation-model';
import { copy } from './Navigation.copy';
export function NavigationPhoneView({ items, presentation }: SurfaceProps<NavigationProps>) {
  return <header className="app-navigation app-navigation-phone" data-region="app.navigation" data-surface="phone" data-orientation={presentation.orientation}>
    <a className="app-brand" href={items[0].href}>{copy.brand}</a>
    <details><summary>{copy.menu}</summary><nav aria-label={copy.navigation}>{items.map(item => <a key={item.key} href={item.href} aria-current={item.active ? 'page' : undefined}>{item.label}</a>)}</nav></details>
  </header>;
}
