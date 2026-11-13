import { createFileRoute } from '@tanstack/react-router';
import { BeadsSample } from '../features/beads/BeadsSample';
export const Route = createFileRoute('/beads')({ ssr: false, component: BeadsSample });
