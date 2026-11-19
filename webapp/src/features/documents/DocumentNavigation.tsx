import { defineDeviceRegion } from '../../presentation/Presentation';
import type { DocumentBrowserProps } from './contracts';
import { DocumentNavigationPhoneView } from './DocumentNavigation.phone.view';
import { DocumentNavigationTabletView } from './DocumentNavigation.tablet.view';
import { DocumentNavigationDesktopView } from './DocumentNavigation.desktop.view';
export const DocumentNavigation = defineDeviceRegion<DocumentBrowserProps>({
  id: 'documents.navigation', phone: DocumentNavigationPhoneView, tablet: DocumentNavigationTabletView, desktop: DocumentNavigationDesktopView,
});
