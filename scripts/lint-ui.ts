import { readFileSync } from 'node:fs';
import { checkUI, type Policy } from './ui-policy.ts';
try {
  const diagnostics = checkUI(process.cwd(), JSON.parse(readFileSync('.github/openlint/ui-contracts.json', 'utf8')) as Policy);
  console.log(JSON.stringify(diagnostics));
  process.exitCode = diagnostics.length ? 1 : 0;
} catch (error) {
  console.log(JSON.stringify([{ rule_id: 'ui/checker-failed', severity: 'error', file: '.github/openlint/ui-contracts.json', line: 1, column: 1, message: error instanceof Error ? error.message : String(error) }]));
  process.exitCode = 1;
}
