import type { Meta, StoryObj } from '@storybook/react-vite';
import { SettingsPresentation } from '../src/features/settings/Settings.presentation';
import { NavigationPresentation } from '../src/features/navigation/Navigation.presentation';
import { navigationItems } from '../src/features/navigation/navigation';
import { PresentationProvider } from '../src/presentation/Presentation';
import type { Presentation } from '../src/presentation/geometry';

const meta = { title: 'Settings/Surfaces', component: SettingsPresentation, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof SettingsPresentation>;
export default meta;
type Story = StoryObj;
const surface = (presentation: Presentation): Story => ({ render: () => <PresentationProvider value={presentation}>
  <div className="application-frame"><NavigationPresentation items={navigationItems('/settings', { connection: 'approved', repository: 'example/project', workspace: 'design', request: 'must-not-leak' })} />
    <div className="application-content"><SettingsPresentation appearanceHref="#/settings/appearance?connection=approved&repository=example%2Fproject&workspace=design" diagnosticsHref="../settings.html" build="6f5b32a-example-build" /></div></div>
</PresentationProvider> });
export const PhonePortrait: Story = surface({ surface: 'phone', orientation: 'portrait' });
export const PhoneLandscape: Story = surface({ surface: 'phone', orientation: 'landscape' });
export const TabletPortrait: Story = surface({ surface: 'tablet', orientation: 'portrait' });
export const TabletLandscape: Story = surface({ surface: 'tablet', orientation: 'landscape' });
export const DesktopPortrait: Story = surface({ surface: 'desktop', orientation: 'portrait' });
export const DesktopLandscape: Story = surface({ surface: 'desktop', orientation: 'landscape' });
