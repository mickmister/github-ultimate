import { createFileRoute } from '@tanstack/react-router';
import { RoutedRuns, parseRunsSearch } from '../features/runs/WorkflowRuns';
export const Route = createFileRoute('/runs')({ ssr: false, validateSearch: parseRunsSearch, component: RoutedRuns });
