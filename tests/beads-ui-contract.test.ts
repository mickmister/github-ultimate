import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { checkUI } from '../scripts/ui-policy';

it('validates the Beads adoption fragment against the full production graph', () => {
  const policy = JSON.parse(readFileSync('.github/openlint/ui-contracts.json', 'utf8'));
  const fragment = JSON.parse(readFileSync('webapp/src/features/beads/ui-contract.fragment.json', 'utf8'));
  policy.features = [...policy.features.filter((feature: { id: string }) => feature.id !== fragment.feature.id), fragment.feature];
  Object.assign(policy.routes, fragment.routes);
  for (const route of Object.keys(fragment.routes)) delete policy.legacyRoutes[route];
  expect(checkUI(process.cwd(), policy)).toEqual([]);
}, 30000);
