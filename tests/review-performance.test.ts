import { expect, test } from 'vitest';
import { measure, reviewPerf } from '../hosted/performance';

test('diagnostics are opt-in and export bounded OTLP traces without error text', async () => {
  reviewPerf.clear();
  await measure('disabled', async () => 'secret answer');
  expect(reviewPerf.status().count).toBe(0);
  reviewPerf.start();
  await measure('reviews.read', async () => 'private document', { cached: true });
  await expect(measure('bridge.gitBlob', async () => { throw new Error('token-and-document-path'); })).rejects.toThrow();
  reviewPerf.stop();
  const exported = reviewPerf.export();
  const spans = exported.resourceSpans[0].scopeSpans[0].spans;
  expect(spans).toHaveLength(3);
  expect(spans[0].traceId).toMatch(/^[a-f0-9]{32}$/);
  expect(spans[1].startTimeUnixNano).toMatch(/^\d+$/);
  expect(spans[2].status.code).toBe(2);
  expect(JSON.stringify(exported)).not.toMatch(/private document|secret answer|token-and-document-path/);
  expect(reviewPerf.summary().map(item => item.operation).sort()).toEqual(['bridge.gitBlob', 'reviews.read']);
  reviewPerf.start();
  for (let index = 0; index < 2002; index++) await measure('operation', async () => undefined);
  expect(reviewPerf.status()).toEqual({ running: true, count: 2000, dropped: 2 });
  reviewPerf.clear();
});
