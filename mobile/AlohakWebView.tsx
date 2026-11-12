import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { WebView } from 'react-native-webview';
import type { ViewProps } from 'react-native';
import { nativeWebViewEvent } from '../src/mobile-webview';

export type DocumentEvent = { documentId: string; documentURL: string; state: 'loading' | 'ready' | 'error'; message?: string };
type MessageEvent = { documentId: string; documentURL: string; isMainFrame: boolean; data: string; replyId: string };
export type AlohakWebViewHandle = { respond(replyId: string, data: string): Promise<void>; goBack(): void; goForward(): void; reload(): void };
type Props = ViewProps & {
  entryURL: string; scopeURL: string; bootstrap: string;
  onDocument(event: { nativeEvent: DocumentEvent }): void;
  onMessage(event: { nativeEvent: MessageEvent }): void;
  onNavigation(canGoBack: boolean, canGoForward: boolean): void;
};

/** The pnpm patch makes this an opt-in native contract, with stock page messaging disabled. */
export default forwardRef<AlohakWebViewHandle, Props>(function AlohakWebView(props, ref) {
  const web = useRef<WebView>(null), documentId = useRef('');
  const configuration = useMemo(() => ({ alohakScope: props.scopeURL }), [props.scopeURL]);
  useImperativeHandle(ref, () => ({
    async respond(replyId, data) { web.current?.postMessage(JSON.stringify({ documentId: documentId.current, replyId, data })); },
    goBack() { web.current?.goBack(); }, goForward() { web.current?.goForward(); }, reload() { web.current?.reload(); },
  }), []);
  useEffect(() => { if (props.bootstrap) web.current?.injectJavaScript(props.bootstrap); }, [props.bootstrap]);
  return <WebView ref={web} style={props.style} source={{ uri: props.entryURL }}
    injectedJavaScriptObject={configuration} applicationNameForUserAgent="Alohak/1"
    originWhitelist={['https://*']} onShouldStartLoadWithRequest={() => false}
    javaScriptEnabled domStorageEnabled sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false}
    allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
    mixedContentMode="never" javaScriptCanOpenWindowsAutomatically={false} setSupportMultipleWindows
    geolocationEnabled={false} mediaCapturePermissionGrantType="deny" allowsLinkPreview={false}
    allowsBackForwardNavigationGestures onOpenWindow={() => {}}
    onNavigationStateChange={state => props.onNavigation(state.canGoBack, state.canGoForward)}
    onError={() => props.onDocument({ nativeEvent: { state: 'error', documentId: 'unavailable', documentURL: '', message: 'Document load failed; reload to retry.' } })}
    onMessage={({ nativeEvent }) => {
      const event = nativeWebViewEvent(nativeEvent.data);
      if (!event) return;
      if (event.type === 'document') { documentId.current = event.documentId; props.onDocument({ nativeEvent: event }); }
      else props.onMessage({ nativeEvent: event });
    }} />;
});
