import type { MobileGrant } from '../src/mobile-protocol';
import { usePiConnections } from './PiConnections.hooks';
import { PiConnectionsView } from './PiConnections.view';
export function PiConnections({ grant }: { grant?: MobileGrant }) { return <PiConnectionsView model={usePiConnections(grant)} grant={grant} />; }
