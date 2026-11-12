import { requireNativeViewManager } from 'expo-modules-core';
import type { ViewProps } from 'react-native';
import type { ComponentType, Ref } from 'react';
export type DocumentEvent = { documentId: string; documentURL: string; state: 'loading' | 'ready' | 'error'; message?: string };
export type MessageEvent = { documentId: string; documentURL: string; isMainFrame: boolean; data: string; replyId: string };
export type AlohakWebViewHandle = { respond(replyId: string, data: string): Promise<void> };
type Props = ViewProps & {
  entryURL: string;
  scopeURL: string;
  bootstrap: string;
  onDocument(event: { nativeEvent: DocumentEvent }): void;
  onMessage(event: { nativeEvent: MessageEvent }): void;
};
export default requireNativeViewManager<Props>('AlohakWebView') as ComponentType<Props & { ref?: Ref<AlohakWebViewHandle> }>;
