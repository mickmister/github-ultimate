import type { StoryObj } from '@storybook/react-vite';
import { PresentationProvider } from '../src/presentation/Presentation';
import { Fixture } from './Reviews.stories';

export default { title: 'Web app/Reviews detail surfaces', parameters: { layout: 'fullscreen' } };
type Story = StoryObj;
export const PhonePortrait: Story = { render: () => <PresentationProvider value={{ surface: 'phone', orientation: 'portrait' }}><Fixture focused process /></PresentationProvider> };
export const PhoneLandscape: Story = { render: () => <PresentationProvider value={{ surface: 'phone', orientation: 'landscape' }}><Fixture focused process /></PresentationProvider> };
export const TabletPortrait: Story = { render: () => <PresentationProvider value={{ surface: 'tablet', orientation: 'portrait' }}><Fixture focused process /></PresentationProvider> };
export const TabletLandscape: Story = { render: () => <PresentationProvider value={{ surface: 'tablet', orientation: 'landscape' }}><Fixture focused process /></PresentationProvider> };
export const DesktopPortrait: Story = { render: () => <PresentationProvider value={{ surface: 'desktop', orientation: 'portrait' }}><Fixture focused process /></PresentationProvider> };
export const DesktopLandscape: Story = { render: () => <PresentationProvider value={{ surface: 'desktop', orientation: 'landscape' }}><Fixture focused process /></PresentationProvider> };
export const Adaptive: Story = { render: () => <PresentationProvider><Fixture focused process /></PresentationProvider> };
