import { defineDeviceRegion } from '../../presentation/Presentation';
import type { BoardProps } from './BeadsBoard.view';
import { BeadsBoardPhoneView } from './BeadsBoard.phone.view';
import { BeadsBoardTabletView } from './BeadsBoard.tablet.view';
import { BeadsBoardDesktopView } from './BeadsBoard.desktop.view';
export const BeadsBoardPresentation = defineDeviceRegion<BoardProps>({ id: 'beads.board', phone: BeadsBoardPhoneView, tablet: BeadsBoardTabletView, desktop: BeadsBoardDesktopView });
