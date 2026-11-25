/** Engineering defaults for one explicit invocation; product policy is tracked
 * separately. Explicit Continue starts a fresh bounded invocation. */
export const chatLimits = { modelTurns: 12, toolCalls: 24, capabilityCalls: 64, elapsedMs: 300_000, outputBytes: 512 * 1024 } as const;
export type ChatLimits = { [K in keyof typeof chatLimits]: number };
export class ChatBudget {
  readonly limits: ChatLimits;
  private started: number;
  private turns = 0;
  private tools = 0;
  private capabilities = 0;
  private bytes = 0;
  constructor(limits: Partial<ChatLimits> = {}, private now = Date.now) {
    this.limits = { ...chatLimits, ...limits };
    for (const value of Object.values(this.limits)) if (!Number.isSafeInteger(value) || value <= 0) throw Error('Agent budgets must be positive integers.');
    this.started = now();
  }
  check() { if (this.now() - this.started >= this.limits.elapsedMs) throw Error('Paused: agent time budget reached. Continue explicitly to resume.'); }
  request() { this.check(); if (++this.turns > this.limits.modelTurns) throw Error('Paused: model turn budget reached. Continue explicitly to resume.'); }
  tool() { this.check(); if (++this.tools > this.limits.toolCalls) throw Error('Paused: tool-call budget reached. Continue explicitly to resume.'); }
  capability() { this.check(); if (++this.capabilities > this.limits.capabilityCalls) throw Error('Paused: capability-call budget reached. Continue explicitly to resume.'); }
  output(value: unknown) { this.bytes += new TextEncoder().encode(JSON.stringify(value)).length; if (this.bytes > this.limits.outputBytes) throw Error('Paused: output budget reached. Continue explicitly to resume.'); }
}
