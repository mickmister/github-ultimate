import { useBeadsFeature, type BeadsServices, type BeadsNavigation } from './Beads.hooks';
import { BeadsPresentation } from './Beads.presentation';

export function BeadsSample({ host, navigation }: { host?: BeadsServices; navigation?: BeadsNavigation }) {
  const page = useBeadsFeature(host, navigation);
  // Both models live above both presentation boundaries. Workspace identity,
  // rather than the selected surface, is the intentional reset boundary.
  return <BeadsPresentation {...page} />;
}
