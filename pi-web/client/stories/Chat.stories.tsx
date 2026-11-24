import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DesktopChat, PhoneChat, TabletChat } from '../chat/Chat.view';
import type { ChatModel } from '../chat/Chat.hooks';
import { useTheme } from '../hooks/useTheme';
import { usePreviewSlots } from '../chat/PreviewSlots.hooks';
import { conversation, tools } from './messages';

type Mode = 'conversation' | 'draft' | 'tools' | 'interrupted' | 'save-error';
function ChatStory({ mode = 'conversation', device = 'desktop' }: { mode?: Mode; device?: 'phone' | 'tablet' | 'desktop' }) {
  const theme = useTheme(), [draft, setDraft] = useState(''), [search, setSearch] = useState(''), [showList, setShowList] = useState(device !== 'phone');
  const previews = usePreviewSlots(async () => ({ workspace: 'storybook-workspace', slots: [{ id: 'repo:storybook', title: 'Storybook', service: 'storybook', repository: 'example/repo', url: 'https://preview.example/storybook/' }] }));
  const [draftMode, setDraftMode] = useState(mode === 'draft'), [dirty, setDirty] = useState(mode === 'save-error');
  const [messages, setMessages] = useState(mode === 'draft' ? [] : mode === 'tools' ? tools : conversation);
  const inference = { id: 'model', revision: '1', name: 'Configured inference', model: 'gpt-6.1-sol', hostedGrants: [] };
  const storage = { id: 'storage', revision: '1', name: 'Private conversations', endpoint: 'https://storage.example/', bucket: 'conversations', prefix: 'private/', region: 'us-east-1', addressing: 'path' as const, allowRead: true, allowUpload: true, allowOverwrite: false, hostedGrants: [] };
  const chats = [{ sessionId: 'conversation', reference: 'checkpoint', label: 'Browser conversation architecture', updatedAt: '2026-11-24T10:00:00Z', messageCount: 2 }];
  const model: ChatModel = {
    theme, previews, workspace: undefined, workspaces: [], canCreate: true, chooseWorkspace: () => {}, moveWorkspace: async () => {}, presentation: device, inference: [inference], storage: [storage], inferenceId: inference.id, storageId: storage.id, selectedInference: inference, selectedStorage: storage,
    snapshot: { title: 'Browser conversation architecture', sessionId: draftMode ? undefined : 'conversation', reference: draftMode ? undefined : 'checkpoint', messages, busy: false, dirty, phase: mode === 'interrupted' ? 'interrupted' : 'idle' },
    chats: chats.filter(chat => chat.label.toLowerCase().includes(search.toLowerCase())), search, draftMode, busy: false,
    error: dirty ? 'Storage is unavailable. Your unsaved reply is still in memory.' : '', draft, showList,
    setSearch, setDraft, setShowList, setInferenceId: () => {}, chooseStorage: () => {},
    connect: async () => {}, list: async () => { setShowList(true); },
    open: async () => { setMessages(conversation); setDraftMode(false); setShowList(device !== 'phone'); },
    create: async () => { setDraftMode(true); setMessages([]); setDraft(''); setShowList(device !== 'phone'); },
    send: async () => { if (!draft.trim()) return; setMessages(previous => [...previous, { role: 'user', content: draft }]); setDraft(''); setDraftMode(false); },
    close: () => { setDraftMode(true); setMessages([]); }, copyLink: async () => {}, stop: () => {}, retrySave: async () => { setDirty(false); },
  };
  const View = device === 'phone' ? PhoneChat : device === 'tablet' ? TabletChat : DesktopChat;
  return <View model={model} />;
}
const meta = { title: 'Pi Web/Chat', component: ChatStory, args: { mode: 'conversation', device: 'desktop' } } satisfies Meta<typeof ChatStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Conversation: Story = {};
export const Draft: Story = { args: { mode: 'draft' } };
export const ToolCalls: Story = { args: { mode: 'tools' } };
export const Interrupted: Story = { args: { mode: 'interrupted' } };
export const SaveError: Story = { args: { mode: 'save-error' } };
export const Phone: Story = { args: { device: 'phone' } };
export const Tablet: Story = { args: { device: 'tablet' } };
