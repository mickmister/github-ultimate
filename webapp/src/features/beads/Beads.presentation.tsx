import { defineDevicePage } from '../../presentation/Presentation';
import type { BeadsPageProps } from './BeadsSample.view';
import { BeadsPhoneView } from './Beads.phone.view';
import { BeadsTabletView } from './Beads.tablet.view';
import { BeadsDesktopView } from './Beads.desktop.view';
export const BeadsPresentation = defineDevicePage<BeadsPageProps>({ id: 'beads', phone: BeadsPhoneView, tablet: BeadsTabletView, desktop: BeadsDesktopView });
