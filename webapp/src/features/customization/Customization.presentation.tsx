import { defineDevicePage } from '../../presentation/Presentation';
import type { CustomizationProps } from './contracts';
import { CustomizationPhoneView } from './Customization.phone.view';
import { CustomizationTabletView } from './Customization.tablet.view';
import { CustomizationDesktopView } from './Customization.desktop.view';
import './customization.css';
export const CustomizationPresentation = defineDevicePage<CustomizationProps>({
  id: 'customization', phone: CustomizationPhoneView, tablet: CustomizationTabletView, desktop: CustomizationDesktopView,
});
