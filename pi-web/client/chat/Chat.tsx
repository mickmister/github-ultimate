'use client';
import { I18nProvider } from '@/hooks/useI18n';
import { useChat } from './Chat.hooks';
import { DesktopChat, PhoneChat, TabletChat } from './Chat.view';
import './chat.css';
export function Chat() {
  const model = useChat();
  return <I18nProvider>{model.presentation === 'phone' ? <PhoneChat model={model} /> : model.presentation === 'tablet' ? <TabletChat model={model} /> : <DesktopChat model={model} />}</I18nProvider>;
}
