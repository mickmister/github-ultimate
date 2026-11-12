import { StrictMode, useMemo, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DocumentBrowser } from '../src/features/documents/DocumentBrowser';
import { DocumentBrowserView } from '../src/features/documents/DocumentBrowser.view';
import type { DocumentBrowserActions, DocumentBrowserModel } from '../src/features/documents/contracts';
import { createMockAppHooks, mockDocumentContents, mockSnapshot, readyModel } from './documents.fixtures';
import { ancestorFolders } from '../src/features/documents/document-tree';
import { isMarkdown } from '../src/features/documents/document-format';

function InteractiveBrowser() {
  const appHooks = useMemo(createMockAppHooks, []);
  return <StrictMode><DocumentBrowser appHooks={appHooks} /></StrictMode>;
}

// Presentation fixtures keep inputs and document selection interactive without
// reimplementing the controller. Use Interactive for the complete user journey.
function FixtureBrowser({ initialModel }: { initialModel: DocumentBrowserModel }) {
  const [model, setModel] = useState<DocumentBrowserModel>(() => ({ ...initialModel, expandedFolders: ancestorFolders(initialModel.snapshot?.documents.find(document => document.id === initialModel.documentId)?.path ?? '') }));
  const patch = (value: Partial<DocumentBrowserModel>) => setModel(current => ({ ...current, ...value }));
  const actions: DocumentBrowserActions = {
    connect() { patch({ ...readyModel, snapshot: null, content: null, documentId: '', documentFullscreen: false }); },
    selectConnection(connectionId) { patch({ connectionId }); },
    setRepository(repository) { patch({ repository }); },
    discoverWorkspaces() { patch({ workspaces: readyModel.workspaces, busy: false, error: null }); },
    selectWorkspace(workspaceId) { patch({ workspaceId }); },
    browseDocuments() { patch({ snapshot: mockSnapshot, content: null, documentId: '', documentFullscreen: false, busy: false, error: null }); },
    setQuery(query) { patch({ query }); },
    setExpandedFolders(expandedFolders) { if (!model.query.trim()) patch({ expandedFolders }); },
    setTreeAppearance(treeAppearance) { patch({ treeAppearance }); },
    selectDocument(documentId) {
      const path = model.snapshot?.documents.find(document => document.id === documentId)?.path ?? '';
      patch({ documentId, expandedFolders: [...new Set([...model.expandedFolders, ...ancestorFolders(path)])], content: mockDocumentContents[documentId] ?? 'Long-content fixture document.', documentMode: isMarkdown(path) ? 'markdown' : 'source', documentFullscreen: true, busy: false, error: null });
    },
    setDocumentMode(documentMode) { patch({ documentMode }); },
    setDocumentFullscreen(documentFullscreen) { patch({ documentFullscreen }); },
  };
  return <DocumentBrowserView model={model} actions={actions} />;
}

const meta = {
  title: 'Web app/Document browser',
  component: DocumentBrowserView,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DocumentBrowserView>;
export default meta;
type Story = StoryObj;

export const Interactive: Story = { render: () => <InteractiveBrowser /> };
export const ReadingDocument: Story = { render: () => <FixtureBrowser initialModel={readyModel} /> };
export const SourceDocument: Story = { render: () => <FixtureBrowser initialModel={{ ...readyModel, documentMode: 'source' }} /> };
export const MarkdownPreview: Story = { render: () => <FixtureBrowser initialModel={{ ...readyModel, documentMode: 'markdown' }} /> };
export const MermaidDiagrams: Story = { render: () => <FixtureBrowser initialModel={{ ...readyModel, documentMode: 'markdown', content: '# Beads changesets\n\n```mermaid\nflowchart TD\n  A[Read snapshot] --> B{Changes available?}\n  B -->|Yes| C[Apply changeset]\n  B -->|No| D[Keep snapshot]\n```\n\n```mermaid\nflowchart LR\n  E[Validate] --> F[Publish]\n```\n\n```text\nflowchart TD\n  This is ordinary source code.\n```' }} /> };
export const InvalidMermaid: Story = { render: () => <FixtureBrowser initialModel={{ ...readyModel, documentMode: 'markdown', content: '# Invalid diagram\n\n```mermaid\nflowchart TD\n  A[Unclosed node\n```\n\nThe rest of the document still renders.\n\n```mermaid\nflowchart TD\n  A[Valid diagram] --> B[Still renders]\n```' }} /> };
export const UntrustedMarkdown: Story = { render: () => <FixtureBrowser initialModel={{ ...readyModel, documentId: 'unsafeMarkdown', content: mockDocumentContents.unsafeMarkdown, documentMode: 'markdown' }} /> };
export const JsonSource: Story = { render: () => <FixtureBrowser initialModel={{ ...readyModel, documentId: 'config', content: mockDocumentContents.config, documentMode: 'source' }} /> };
export const NestedFolders: Story = { render: () => <FixtureBrowser initialModel={{ ...readyModel, documentId: 'interview', content: mockDocumentContents.interview, documentFullscreen: false }} /> };
export const FilteredDocuments: Story = { render: () => <FixtureBrowser initialModel={{ ...readyModel, query: 'notes.md', documentFullscreen: false }} /> };
export const CompactTealTree: Story = { render: () => <FixtureBrowser initialModel={{ ...readyModel, treeAppearance: { density: 'compact', accent: 'teal' }, documentFullscreen: false }} /> };
export const ChooseDocument: Story = { render: () => <FixtureBrowser initialModel={{ ...readyModel, documentId: '', content: null }} /> };
export const Loading: Story = { render: () => <FixtureBrowser initialModel={{ ...readyModel, content: null, busy: true, canDiscover: false, canBrowse: false, status: 'Reading and verifying document…' }} /> };
export const ReadError: Story = { render: () => <FixtureBrowser initialModel={{ ...readyModel, content: null, error: 'The approved access route is no longer available. Reconnect your extension and try again.', status: 'Document request failed.' }} /> };
export const NoConnections: Story = { render: () => <FixtureBrowser initialModel={{ ...readyModel, connections: [], connectionId: '', workspaces: [], workspaceId: '', snapshot: null, documentId: '', content: null, canBrowse: false, canDiscover: false, status: 'No approved signed-in connections. Open extension connection settings or Alohak native settings to sign in and approve this deployment.' }} /> };
export const EmptyWorkspace: Story = { render: () => <FixtureBrowser initialModel={{ ...readyModel, snapshot: { ...mockSnapshot, documents: [] }, documentId: '', content: null, status: '0 document(s) in the verified snapshot.' }} /> };
export const LongContent: Story = { render: () => <FixtureBrowser initialModel={{ ...readyModel,
  snapshot: { ...mockSnapshot, documents: Array.from({ length: 40 }, (_, index) => ({ id: `long-${index}`, path: `research/very-long-workspace-and-document-titles/iteration-${index + 1}/a-detailed-investigation-of-flexible-and-accessible-workspace-interfaces.md`, size: 12000 })) },
  documentId: 'long-0', content: Array.from({ length: 30 }, (_, index) => `Section ${index + 1}\n\n${'A long document should wrap naturally while leaving navigation and keyboard focus usable. '.repeat(6)}`).join('\n\n'),
}} /> };
