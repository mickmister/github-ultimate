import { expect, it } from 'vitest';
import { nativeWebViewEvent } from '../src/mobile-webview';

it('decodes native document identity independently of mutable browser-navigation state', () => {
  const identity = { documentId: 'native-generation', documentURL: 'https://pages.example/original/app/' };
  expect(nativeWebViewEvent(JSON.stringify({ type: 'document', ...identity, state: 'ready' }))).toEqual({ type: 'document', ...identity, state: 'ready' });
  expect(nativeWebViewEvent(JSON.stringify({ type: 'message', ...identity, isMainFrame: true, replyId: 'reply-2', data: '{"id":"request-2"}' }))).toMatchObject({ ...identity, replyId: 'reply-2' });
  // RNWV's general navigation events must never activate the broker.
  expect(nativeWebViewEvent(JSON.stringify({ url: 'https://pages.example/promoted/', loading: false, canGoBack: true }))).toBeUndefined();
});

it('rejects malformed, subframe and incomplete native event envelopes', () => {
  for (const value of ['broken', 'null', '{}', JSON.stringify({ type: 'document', documentId: '', documentURL: '', state: 'ready' }), JSON.stringify({ type: 'message', documentId: 'generation', documentURL: 'https://pages.example/', isMainFrame: false, replyId: 'id', data: '' })]) expect(nativeWebViewEvent(value)).toBeUndefined();
});
