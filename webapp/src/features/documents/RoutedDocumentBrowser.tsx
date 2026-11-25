import { useCallback, useMemo } from 'react';
import { useNavigate, useParams, useRouterState } from '@tanstack/react-router';
import { DocumentBrowser } from './DocumentBrowser';
import { parseDocumentSearch, type DocumentLocation } from './navigation';

export function RoutedDocumentBrowser() {
  const navigate = useNavigate();
  const routeLocation = useRouterState({ select: state => state.location });
  const documentId = useParams({ strict: false, select: params => params.documentId });
  const location = useMemo<DocumentLocation>(() => ({
    ...parseDocumentSearch(routeLocation.search),
    documentId,
  }), [routeLocation, documentId]);
  const go = useCallback((next: DocumentLocation) => {
    const { documentId, ...search } = next;
    if (documentId) void navigate({ to: '/documents/$documentId', params: { documentId }, search });
    else void navigate({ to: '/documents', search });
  }, [navigate]);
  const navigation = useMemo(() => ({ location, navigate: go }), [location, go]);
  return <DocumentBrowser navigation={navigation} />;
}
