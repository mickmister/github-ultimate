import { expect, it } from 'vitest';
import { MobileFixtureBroker } from '../src/mobile-protocol';
import { darkShell, shellPalettes, type ShellTheme } from '../src/mobile-theme';

it('accepts only concrete palettes from the active main document, independently of storage/fixture grants', async () => {
  const received: ShellTheme[] = [];
  const broker = new MobileFixtureBroker(undefined, undefined, theme => received.push(theme));
  const context = { documentId: 'current', documentURL: 'https://example.com/app/', isMainFrame: true };
  const request = (params: unknown) => JSON.stringify({ jsonrpc: '2.0', id: 'theme_1', method: 'theme.set', params });
  broker.activate(context);
  for (const invalid of [{ ...context, isMainFrame: false }, { ...context, documentId: 'old' }, { ...context, documentURL: 'https://other.example/' }]) {
    expect((await broker.handleAsync(invalid, request(shellPalettes.dark))).error).toBeDefined();
  }
  for (const invalid of [{}, { ...shellPalettes.dark, accent: 'var(--accent)' }, { ...shellPalettes.dark, css: 'body{}' }]) {
    expect((await broker.handleAsync(context, request(invalid))).error).toBeDefined();
  }
  expect(received).toEqual([]);
  expect((await broker.handleAsync(context, request(shellPalettes.dark))).error).toBeUndefined();
  expect(received).toEqual([shellPalettes.dark]);
  expect(darkShell(received[0])).toBe(true);
  expect(darkShell(shellPalettes.light)).toBe(false);
  broker.invalidate();
  expect((await broker.handleAsync(context, request(shellPalettes.light))).error).toBeDefined();
  expect(received).toHaveLength(1);
});
