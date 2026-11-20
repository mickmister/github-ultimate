import { defineDeviceRegion } from '../../presentation/Presentation';
import type { NavigationProps } from './navigation-model';
import { NavigationPhoneView } from './Navigation.phone.view';
import { NavigationTabletView } from './Navigation.tablet.view';
import { NavigationDesktopView } from './Navigation.desktop.view';
export const NavigationPresentation = defineDeviceRegion<NavigationProps>({ id: 'app.navigation', phone: NavigationPhoneView, tablet: NavigationTabletView, desktop: NavigationDesktopView });
