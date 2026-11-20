import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { checkUI } from '../scripts/ui-policy';

test('review registration fragment passes the full graph and copy policy when integrated', () => {
  const policy = JSON.parse(readFileSync('.github/openlint/ui-contracts.json', 'utf8'));
  const fragment = JSON.parse(readFileSync('webapp/src/features/reviews/ui-contracts.fragment.json', 'utf8'));
  policy.features.push(...fragment.features);
  Object.assign(policy.routes, fragment.routes);
  for (const route of fragment.removeLegacyRoutes) delete policy.legacyRoutes[route];
  expect(checkUI(process.cwd(), policy)).toEqual([]);
}, 30000);
