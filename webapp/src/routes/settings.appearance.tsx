import { createFileRoute } from '@tanstack/react-router';
import { CustomizationPage } from '../features/customization/Customization';

export const Route = createFileRoute('/settings/appearance')({ component: CustomizationPage });
