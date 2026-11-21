import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useMemo } from 'react';
import { BeadsSample } from '../features/beads/BeadsSample';
import type { BeadsNavigation } from '../features/beads/Beads.hooks';
export const Route = createFileRoute('/beads')({ ssr: false, validateSearch: (search: Record<string, unknown>) => search, component: BeadsRoute });
function BeadsRoute() {
  const navigate = Route.useNavigate();
  const router = useRouter();
  const navigation = useMemo<BeadsNavigation>(() => ({
    read: () => new URLSearchParams(router.state.location.searchStr),
    write: choice => { void navigate({ search: previous => ({ ...previous, ...choice }), replace: true }); },
    subscribe: listener => router.subscribe('onResolved', listener),
  }), [navigate, router]);
  return <BeadsSample navigation={navigation} />;
}
