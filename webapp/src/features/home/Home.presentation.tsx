import { defineDevicePage } from '../../presentation/Presentation';
import { HomePhoneView } from './Home.phone.view';
import { HomeTabletView } from './Home.tablet.view';
import { HomeDesktopView } from './Home.desktop.view';
import type { HomeModel } from './Home.model';
export const HomePresentation = defineDevicePage<HomeModel>({ id: 'home', phone: HomePhoneView, tablet: HomeTabletView, desktop: HomeDesktopView });
