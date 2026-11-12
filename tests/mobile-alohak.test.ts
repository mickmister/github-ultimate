import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { alohakLink, deploymentURL, grantForEntry, matchesMobileGrant, mobileBootstrap, MobileFixtureBroker, mobileReplyScript, resolveAlohakLink } from '../src/mobile-protocol';
import { MobileClient } from '../src/mobile-client';

const entry = 'https://pages.example/project/preview/mobile-proof.html';
const context = { documentId: 'native-1', documentURL: entry, isMainFrame: true };
const request = (method: string, params: object = {}) => JSON.stringify({ jsonrpc: '2.0', id: 'r1', method, params });
function approved() { const broker = new MobileFixtureBroker(); broker.activate(context); broker.approve(grantForEntry(entry)); return broker; }

describe('native fixture authorization (native frame/navigation facts supplied separately)', () => {
  it('requires a native grant even for discovery, and revokes an open document', () => {
    const broker = new MobileFixtureBroker(); broker.activate(context);
    expect(broker.handle(context, request('alohak.discover', { protocolVersion: 1 })).error?.code).toBe(-32001);
    broker.approve(grantForEntry(entry));
    expect(broker.handle(context, request('alohak.discover', { protocolVersion: 1 })).result).toMatchObject({ fixtureOnly: true });
    broker.approve();
    expect(broker.handle(context, request('fixture.echo', { text: 'private' })).error?.code).toBe(-32001);
  });
  it('denies iframe messages, stale generations, changed contexts and invalidated navigation', () => {
    const broker = approved();
    for (const forgery of [{ ...context, isMainFrame: false }, { ...context, documentId: 'old' }, { ...context, documentURL: 'https://pages.example/other/' }]) {
      expect(broker.handle(forgery, request('fixture.echo', { text: 'x' })).error?.code).toBe(-32001);
    }
    broker.invalidate();
    expect(broker.handle(context, request('fixture.echo', { text: 'x' })).error?.code).toBe(-32001);
  });
  it('cannot gain access through page-provided URL/context or a sibling path', () => {
    const broker = approved();
    const sibling = { ...context, documentURL: 'https://pages.example/project/preview-other/index.html' };
    broker.activate(sibling);
    expect(broker.handle(sibling, request('fixture.echo', { text: 'x', documentURL: entry })).error?.code).toBe(-32001);
    broker.activate(context);
    expect(broker.handle(context, request('fixture.echo', { text: 'x', origin: 'https://pages.example' })).error?.code).toBe(-32602);
  });
  it('rejects general fetch, credentials and GitHub/S3 methods', () => {
    const broker = approved();
    for (const method of ['fetch', 'eval', 'github.repositories', 's3.read', 'connections.tokens']) expect(broker.handle(context, request(method)).error?.code).toBe(-32601);
  });
  it('bounds inputs, rejects batches/notifications/unknown envelope fields and survives malformed input', () => {
    const broker = approved();
    for (const raw of ['[]', '{}', '{"jsonrpc":"2.0","method":"fixture.echo"}', '{"id":"r1","jsonrpc":"2.0","method":"fixture.echo","params":{},"origin":"forged"}']) expect(broker.handle(context, raw).error?.code).toBe(-32600);
    expect(broker.handle(context, '{').error?.code).toBe(-32700);
    expect(broker.handle(context, '界'.repeat(6000)).error?.code).toBe(-32600);
    expect(broker.handle(context, '\ud800').error?.code).toBe(-32700);
    expect(broker.handle(context, request('alohak.discover', { protocolVersion: 2 })).error?.code).toBe(-32602);
    expect(broker.handle(context, request('fixture.echo', { text: 'ok' })).result).toEqual({ text: 'ok' });
  });
});

describe('custom-scheme navigation-only links', () => {
  it('round trips query/fragment without changing the configured deployment', () => {
    const target = 'https://pages.example/project/preview/app/?workspace=a%2Fb#/documents/readme';
    expect(resolveAlohakLink(alohakLink(entry, target), entry)).toBe(target);
  });
  it.each([
    'alohak://open?route=//evil.example/',
    'alohak://open?route=/other/',
    'alohak://open?route=/project/preview-other/',
    'alohak://open?route=/project/preview/%252e%252e/other',
    'alohak://open?route=/project/preview/&grant=true',
    'alohak://open?route=/project/preview/&route=/other/',
    'alohak://user@open?route=/project/preview/',
    'alohak://open?route=/project/preview/#token',
    'https://open?route=/project/preview/',
  ])('rejects untrusted link %s', link => expect(() => resolveAlohakLink(link, entry)).toThrow());
  it('denies ambiguous deployment paths, schemes and credentials', () => {
    for (const url of ['http://pages.example/project/', 'https://u:p@pages.example/project/', 'https://pages.example/project/%2e%2e/other', 'https://pages.example/project/../other', 'https://pages.example:444/project/']) expect(() => deploymentURL(url)).toThrow();
    expect(matchesMobileGrant(grantForEntry(entry), 'https://evil.example/project/preview/')).toBe(false);
  });
});

describe('installed bootstrap, safe replies and page-side JSON-RPC', () => {
  it('treats scripts in reply bodies as inert data and checks document generation', () => {
    const page = new EventTarget() as EventTarget & Record<string, any>;
    page.top = page; page.webkit = { messageHandlers: { alohak: { postMessage() {} } } };
    const received: string[] = [];
    page.addEventListener('alohak-native-message', (event: Event) => received.push((event as CustomEvent<string>).detail));
    const realm = { window: page, Event, CustomEvent };
    runInNewContext(mobileBootstrap('doc1', 'ios'), realm);
    const hostile = '";globalThis.pwned=true;//\u2028</script>';
    runInNewContext(mobileReplyScript('old', hostile), realm);
    expect(received).toEqual([]);
    runInNewContext(mobileReplyScript('doc1', hostile), realm);
    expect(received).toEqual([hostile]);
    expect((realm as any).pwned).toBeUndefined();
  });
  it('runs discovery and echo through the actual page client with structured denial', async () => {
    const page = new EventTarget() as unknown as Window;
    const broker = approved();
    page.alohakNative = { protocolVersion: 1, documentId: context.documentId, postMessage(raw) {
      const reply = broker.handle(context, raw);
      queueMicrotask(() => page.dispatchEvent(new CustomEvent('alohak-native-message', { detail: JSON.stringify(reply) })));
    } };
    const client = new MobileClient(page);
    expect(await client.request('alohak.discover', { protocolVersion: 1 })).toMatchObject({ fixtureOnly: true });
    expect(await client.request('fixture.echo', { text: 'round trip' })).toEqual({ text: 'round trip' });
    await expect(client.request('github.repositories', {})).rejects.toThrow('fixture-only');
    client.close();
  });
  it('rejects outstanding calls when the document changes or client closes', async () => {
    const page = new EventTarget() as unknown as Window;
    let sentId = '';
    page.alohakNative = { protocolVersion: 1, documentId: 'old', postMessage(data) { sentId = JSON.parse(data).id; } };
    const client = new MobileClient(page);
    const first = client.request('fixture.echo', { text: 'x' });
    page.alohakNative.documentId = 'new';
    page.dispatchEvent(new CustomEvent('alohak-native-message', { detail: JSON.stringify({ jsonrpc: '2.0', id: sentId, result: 'stale' }) }));
    await expect(first).rejects.toThrow('Document changed');
    const second = client.request('fixture.echo', { text: 'x' });
    client.close();
    await expect(second).rejects.toThrow('closed');
  });
});
