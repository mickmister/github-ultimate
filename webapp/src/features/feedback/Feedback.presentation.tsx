import type { ReactNode } from 'react';
import { defineDeviceRegion } from '../../presentation/Presentation';
import { FeedbackPhoneView } from './Feedback.phone.view';
import { FeedbackTabletView } from './Feedback.tablet.view';
import { FeedbackDesktopView } from './Feedback.desktop.view';

export interface FeedbackRegionProps { context: ReactNode; editor: ReactNode; footer: ReactNode }
export const FeedbackRegion = defineDeviceRegion<FeedbackRegionProps>({ id: 'feedback.shell', phone: FeedbackPhoneView, tablet: FeedbackTabletView, desktop: FeedbackDesktopView });
