import { defineDevicePage } from '../../presentation/Presentation';
import type { DocumentBrowserProps } from './contracts';
import { DocumentsPhoneView } from './Documents.phone.view';
import { DocumentsTabletView } from './Documents.tablet.view';
import { DocumentsDesktopView } from './Documents.desktop.view';
import './documents-surfaces.css';

export const DocumentsPresentation = defineDevicePage<DocumentBrowserProps>({
  id: 'documents', phone: DocumentsPhoneView, tablet: DocumentsTabletView, desktop: DocumentsDesktopView,
});
