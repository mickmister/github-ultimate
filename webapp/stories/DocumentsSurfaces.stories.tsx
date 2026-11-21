import { useMemo } from 'react';
import type { StoryObj } from '@storybook/react-vite';
import { PresentationProvider } from '../src/presentation/Presentation';
import { DocumentBrowser } from '../src/features/documents/DocumentBrowser';
import { createMockAppHooks } from './documents.fixtures';
import type { Presentation } from '../src/presentation/geometry';

function Pilot({ value }: { value?: Presentation }) {
  const appHooks = useMemo(createMockAppHooks, []);
  return <PresentationProvider value={value}><DocumentBrowser appHooks={appHooks} /></PresentationProvider>;
}
export default { title: 'Web app/Documents surfaces', parameters: { layout: 'fullscreen' } };
type Story = StoryObj;
export const PhonePortrait: Story = { render: () => <Pilot value={{ surface: 'phone', orientation: 'portrait' }} /> };
export const PhoneLandscape: Story = { render: () => <Pilot value={{ surface: 'phone', orientation: 'landscape' }} /> };
export const TabletPortrait: Story = { render: () => <Pilot value={{ surface: 'tablet', orientation: 'portrait' }} /> };
export const TabletLandscape: Story = { render: () => <Pilot value={{ surface: 'tablet', orientation: 'landscape' }} /> };
export const DesktopPortrait: Story = { render: () => <Pilot value={{ surface: 'desktop', orientation: 'portrait' }} /> };
export const DesktopLandscape: Story = { render: () => <Pilot value={{ surface: 'desktop', orientation: 'landscape' }} /> };
export const Adaptive: Story = { render: () => <Pilot /> };
