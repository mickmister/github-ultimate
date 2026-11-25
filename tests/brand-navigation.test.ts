import { expect, test } from 'vitest';
import { brandDestination } from '../pi-web/client/chat/brand-navigation';
import { mobileHandoff } from '../src/mobile-handoff';

const href = 'https://example.com/previews/work/pi-web/?repository=owner%2Fstore&workspace=work&session=id&checkpoint=pin#message';
test('Alohak brand preserves the exact mobile handoff route and revision', () => {
  for (const [agent, touch] of [['iPhone', 0], ['Android', 0], ['iPad', 0], ['Macintosh', 5]] as const) {
    expect(brandDestination(href, agent, touch, false)).toBe(mobileHandoff(href, agent, touch)!.appURL);
  }
});
test('desktop and an already-open Alohak go home within the current deployment', () => {
  for (const [agent, touch, native] of [['Desktop', 0, false], ['Macintosh', 0, false], ['iPhone Alohak/1', 5, false], ['iPhone', 5, true]] as const) {
    expect(brandDestination(href, agent, touch, native)).toBe('https://example.com/previews/work/app/');
  }
});
