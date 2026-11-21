import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { resolve } from 'node:path';
import { decodeTelemetryArchive } from '../../src/otel-tables';
import { archive, members } from '../fixtures/workflow-runs';

let server: ViteDevServer, origin: string;
test.beforeAll(async () => {
  server = await createServer({ root: resolve('webapp'), configFile: resolve('webapp/vite.config.ts'), server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); origin = server.resolvedUrls!.local[0];
});
test.afterAll(async () => { await server?.close(); });
test('production DuckDB engine imports independent OTLP rows, locks I/O and executes exact SQL', async ({ page }) => {
  test.setTimeout(180000);
  await page.route(`${origin}probe`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local worker probe</title>' }));
  await page.goto(`${origin}probe`);
  const data = await decodeTelemetryArchive(archive, members, 'worker');
  const result = await page.evaluate(async data => {
    const modulePath = '/src/features/runs/query-engine.ts';
    const { TelemetryQueryEngine } = await import(modulePath);
    const engine = new TelemetryQueryEngine();
    try {
      await engine.load(data);
      const result = await engine.query('SELECT count(*) AS n, sum(duration_ms) AS total_ms FROM spans');
      let denied = '';
      try { await engine.query("SELECT * FROM read_csv('https://outside.example.test/private.csv')"); } catch (cause) { denied = String(cause); }
      return { result, denied };
    } finally { engine.dispose(); }
  }, data);
  expect(result.result.rows).toEqual([['2', '400']]);
  expect(result.denied).toMatch(/disabled|Permission|external|not allowed/i);
});
