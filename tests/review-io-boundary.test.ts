import { expect, test } from 'vitest';
import { build } from 'esbuild';

test.each(['src/background.ts', 'mobile/github.ts'])('%s does not bundle evolving review/form domain validators', async entry => {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, metafile: true, packages: 'external', logLevel: 'silent' });
  const inputs = Object.keys(result.metafile!.inputs);
  expect(inputs).toContain('src/review-io.ts');
  for (const domain of ['src/review-protocol.ts', 'src/protocol.ts', 'hosted/reviews.ts']) expect(inputs).not.toContain(domain);
});
