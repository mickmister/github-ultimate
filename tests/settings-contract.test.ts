import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { checkUI } from '../scripts/ui-policy';

it('validates Settings and navigation with the pending parent registration', () => {
  const policy = JSON.parse(readFileSync('.github/openlint/ui-contracts.json', 'utf8'));
  const registration = JSON.parse(readFileSync('webapp/src/features/settings/registration.json', 'utf8'));
  policy.features = policy.features.filter((feature: { id: string }) => !registration.features.some((pending: { id: string }) => pending.id === feature.id));
  policy.features.push(...registration.features);
  Object.assign(policy.routes, registration.routes);
  expect(checkUI(process.cwd(), policy)).toEqual([]);
}, 60000);
