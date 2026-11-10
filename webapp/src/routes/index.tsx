import { createFileRoute } from '@tanstack/react-router';
import { DocumentBrowser } from '../features/documents/DocumentBrowser';

export const Route = createFileRoute('/')({ ssr: false, component: DocumentBrowser });
