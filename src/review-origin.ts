import { z } from 'zod';
import type { ReviewRequest } from './review-protocol';

/** Publication, never the page, captures the originating session. Amendments retain it. */
export function reviewOrigin(input: Record<string, unknown>, previous: ReviewRequest | undefined, environment: { VK_WORKSPACE_ID?: string; VK_SESSION_ID?: string }, mode?: 'handoff' | 'none') {
  const result = { ...input };
  if (mode === 'none') { delete result.response_effect; return result; }
  if (!mode && previous) { if (previous.response_effect) result.response_effect = previous.response_effect; else delete result.response_effect; return result; }
  if (!mode && result.response_effect) return result;
  const { VK_WORKSPACE_ID: workspace_id, VK_SESSION_ID: session_id } = environment;
  if (!workspace_id && !session_id) {
    if (mode === 'handoff') throw new Error('VK handoff requires both VK_WORKSPACE_ID and VK_SESSION_ID.');
    return result;
  }
  const pair = z.object({ workspace_id: z.string().uuid(), session_id: z.string().uuid() }).parse({ workspace_id, session_id });
  result.response_effect = { kind: 'vk-session', ...pair }; return result;
}
