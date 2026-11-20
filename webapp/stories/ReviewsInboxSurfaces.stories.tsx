import type { StoryObj } from '@storybook/react-vite';
import { PresentationProvider } from '../src/presentation/Presentation';
import { Fixture } from './Reviews.stories';

export default { title: 'Web app/Reviews inbox surfaces', parameters: { layout: 'fullscreen' } };
type Story = StoryObj;
export const PhonePortrait: Story = { render: () => <PresentationProvider value={{ surface: 'phone', orientation: 'portrait' }}><Fixture /></PresentationProvider> };
export const PhoneLandscape: Story = { render: () => <PresentationProvider value={{ surface: 'phone', orientation: 'landscape' }}><Fixture /></PresentationProvider> };
export const TabletPortrait: Story = { render: () => <PresentationProvider value={{ surface: 'tablet', orientation: 'portrait' }}><Fixture /></PresentationProvider> };
export const TabletLandscape: Story = { render: () => <PresentationProvider value={{ surface: 'tablet', orientation: 'landscape' }}><Fixture /></PresentationProvider> };
export const DesktopPortrait: Story = { render: () => <PresentationProvider value={{ surface: 'desktop', orientation: 'portrait' }}><Fixture /></PresentationProvider> };
export const DesktopLandscape: Story = { render: () => <PresentationProvider value={{ surface: 'desktop', orientation: 'landscape' }}><Fixture /></PresentationProvider> };
export const Adaptive: Story = { render: () => <PresentationProvider><Fixture /></PresentationProvider> };
