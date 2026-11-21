import { defineDevicePage } from '../../presentation/Presentation';
import type { SettingsProps } from './contracts';
import { SettingsPhoneView } from './Settings.phone.view';
import { SettingsTabletView } from './Settings.tablet.view';
import { SettingsDesktopView } from './Settings.desktop.view';
export const SettingsPresentation = defineDevicePage<SettingsProps>({ id: 'settings', phone: SettingsPhoneView, tablet: SettingsTabletView, desktop: SettingsDesktopView });
