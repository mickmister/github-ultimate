import type { Meta, StoryObj } from '@storybook/react-vite';
import { InteractionReview } from '../src/features/interactions/InteractionReview';
import { interactionBinding, interactionServices } from './interactions.fixtures';

const meta = { title: 'Web app/Interactions', component: InteractionReview, parameters: { layout: 'padded', docs: { description: { component: 'Production read-only review component with fixture transport/native adapters. Paste a v1 or v2 export; no write or dispatch capability.' } } } } satisfies Meta<typeof InteractionReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const BatchReview: Story = { args: { binding: interactionBinding, services: interactionServices } };
export const MissingNativeReader: Story = { args: { binding: interactionBinding, services: { ...interactionServices, native: undefined } } };
