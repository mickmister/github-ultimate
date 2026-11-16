import { useEffect, useMemo, useRef } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Customization } from '../src/features/customization/Customization';
import { ReviewWorkspace } from '../src/features/reviews/ReviewWorkspace';
import { createReviewFixture, reviewScope } from './reviews.fixtures';
import { renderForm, shadow } from '../../src/ui';

function Appearance() {
  const hooks = useMemo(() => createReviewFixture(), []);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = host.current!.shadowRoot ?? shadow(host.current!);
    renderForm(root, { format: 'standard', version: 1, id: 'legacy-theme', title: 'Original form renderer', questions: [{ id: 'next', type: 'choices', title: 'Legacy choices', description: 'Original form theme compatibility.', choices: [{ id: 'keep', label: 'Keep' }] }] }, { repository: 'example/storage', number: 1, comment_id: '1', revision: 'a'.repeat(40) }, () => true, false);
    return () => { for (const child of root.children) if (child.tagName !== 'STYLE') child.remove(); };
  }, []);
  return <><Customization /><ReviewWorkspace appHooks={hooks} location={{ connection: reviewScope.connectionId, repository: reviewScope.repository, workspace: reviewScope.workspace, requestId: 'reader-01' }} /><div ref={host} data-testid="legacy-theme-host" /></>;
}
export default { title: 'Web app/Customization', component: Customization, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof Customization>;
export const AppearanceEditor: StoryObj = { render: () => <Appearance /> };
