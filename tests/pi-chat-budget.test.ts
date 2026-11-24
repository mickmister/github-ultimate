import { expect, test } from 'vitest';
import { ChatBudget } from '../hosted/pi-chat-budget';

test('per-invocation budgets bound model turns, tools, nested capabilities and UTF-8 output', () => {
  const budget = new ChatBudget({ modelTurns: 1, toolCalls: 1, capabilityCalls: 1, outputBytes: 5 });
  budget.request(); budget.tool(); budget.capability(); budget.output('é');
  expect(() => budget.request()).toThrow('model turn'); expect(() => budget.tool()).toThrow('tool-call'); expect(() => budget.capability()).toThrow('capability-call'); expect(() => budget.output('é')).toThrow('output');
});
test('elapsed time and malformed budgets are checked independently of tool/model progress', () => {
  let now = 0; const budget = new ChatBudget({ elapsedMs: 100 }, () => now);
  budget.check(); now = 100; expect(() => budget.check()).toThrow('time budget');
  for (const elapsedMs of [0, -1, Infinity, 1.5]) expect(() => new ChatBudget({ elapsedMs })).toThrow('positive integers');
});
