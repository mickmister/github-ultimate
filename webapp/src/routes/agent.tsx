import { createFileRoute } from '@tanstack/react-router';
import { Agent } from '../features/agent/Agent';
export const Route = createFileRoute('/agent')({ component: Agent });
