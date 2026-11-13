import { createFileRoute } from '@tanstack/react-router';
import { RoutedDocumentBrowser } from '../features/documents/RoutedDocumentBrowser';
import { parseDocumentSearch } from '../features/documents/navigation';

export const Route = createFileRoute('/documents')({ ssr: false, validateSearch: parseDocumentSearch, component: RoutedDocumentBrowser });
