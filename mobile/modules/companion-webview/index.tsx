import { requireNativeViewManager } from 'expo-modules-core';
import type { ViewProps } from 'react-native';
export type DocumentEvent = { documentId: string; documentURL: string; state: 'loading' | 'ready' | 'error'; message?: string };
export type MessageEvent = { documentId: string; documentURL: string; isMainFrame: boolean; data: string };
type Props = ViewProps & {
  entryURL: string;
  scopeURL: string;
  bootstrap: string;
  reply: string;
  onDocument(event: { nativeEvent: DocumentEvent }): void;
  onMessage(event: { nativeEvent: MessageEvent }): void;
};
export default requireNativeViewManager<Props>('CompanionWebView');
