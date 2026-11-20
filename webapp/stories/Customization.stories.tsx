import { useEffect, useMemo, useRef, useState } from 'react';
import type { StoryObj } from '@storybook/react-vite';
import { CustomizationPage, CustomizationProvider } from '../src/features/customization/Customization';
import { PresentationProvider } from '../src/presentation/Presentation';
import type { Presentation } from '../src/presentation/geometry';
import { uiCustomization } from '../../src/ui-customization';
import { ReviewWorkspace } from '../src/features/reviews/ReviewWorkspace';
import { createReviewFixture, reviewScope } from './reviews.fixtures';
import { renderForm, shadow } from '../../src/ui';

function PortableExamples() {
  const hooks = useMemo(() => createReviewFixture(), []);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = host.current!.shadowRoot ?? shadow(host.current!);
    renderForm(root, { format: 'standard', version: 1, id: 'legacy-theme', title: 'Original form renderer', questions: [{ id: 'next', type: 'choices', title: 'Legacy choices', description: 'Original form theme compatibility.', choices: [{ id: 'keep', label: 'Keep' }] }] }, { repository: 'example/storage', number: 1, comment_id: '1', revision: 'a'.repeat(40) }, () => true, false);
    return () => { for (const child of root.children) if (child.tagName !== 'STYLE') child.remove(); };
  }, []);
  return <><ReviewWorkspace appHooks={hooks} location={{ connection: reviewScope.connectionId, repository: reviewScope.repository, workspace: reviewScope.workspace, requestId: 'reader-01' }} /><div ref={host} data-testid="legacy-theme-host" /></>;
}

function Appearance({ value, portable = false }: { value?: Presentation; portable?: boolean }) {
  const [visible, setVisible] = useState(true);
  const fixture = useMemo(() => {
    let fail = false;
    uiCustomization.configure({ read: async () => localStorage.getItem('appearance-story:saved'), write: async value => { if (fail) { fail = false; throw new Error('Device storage unavailable. Retry Save.'); } localStorage.setItem('appearance-story:saved', value); } });
    void uiCustomization.ready();
    return { failNext() { fail = true; } };
  }, []);
  return <PresentationProvider value={value}><CustomizationProvider>
    <div className="appearance-story-tools"><button onClick={() => setVisible(!visible)}>{visible ? 'Leave appearance' : 'Return to appearance'}</button><button onClick={fixture.failNext}>Fail next save</button></div>
    {visible ? <CustomizationPage /> : <div>Another settings page</div>}
    {portable && <PortableExamples />}
  </CustomizationProvider></PresentationProvider>;
}
export default { title: 'Web app/Customization', parameters: { layout: 'fullscreen' } };
type Story = StoryObj;
export const PhonePortrait: Story = { render: () => <Appearance value={{ surface: 'phone', orientation: 'portrait' }} /> };
export const PhoneLandscape: Story = { render: () => <Appearance value={{ surface: 'phone', orientation: 'landscape' }} /> };
export const TabletPortrait: Story = { render: () => <Appearance value={{ surface: 'tablet', orientation: 'portrait' }} /> };
export const TabletLandscape: Story = { render: () => <Appearance value={{ surface: 'tablet', orientation: 'landscape' }} /> };
export const DesktopPortrait: Story = { render: () => <Appearance value={{ surface: 'desktop', orientation: 'portrait' }} /> };
export const DesktopLandscape: Story = { render: () => <Appearance value={{ surface: 'desktop', orientation: 'landscape' }} /> };
export const AppearanceEditor: Story = { render: () => <Appearance /> };
export const PortableCompatibility: Story = { render: () => <Appearance portable /> };
