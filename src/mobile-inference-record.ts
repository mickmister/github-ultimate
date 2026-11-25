import { z } from 'zod';
import { inferenceConfigurationSchema } from './inference-protocol';

// Host-owned credential schema, never a hosted-page descriptor. Keep the whole
// optional auth object in the secure partition, including interrupted rotations.
const secret = z.string().min(1).max(32000);
export const mobileInferenceRecordSchema = inferenceConfigurationSchema.extend({
  id: z.string().uuid(), revision: z.string().uuid(),
  hostedGrants: z.array(z.object({ origin: z.string(), subpath: z.string() }).strict()),
  chatgpt: z.object({
    access: secret.optional(), refresh: secret.optional(), accountId: secret.optional(),
    expires: z.number().finite().optional(), refreshing: z.boolean().optional(),
    pending: z.object({ deviceId: secret, userCode: secret, interval: z.number().finite().positive(), nextPoll: z.number().finite(), expires: z.number().finite(), exchanging: z.boolean().optional() }).strict().optional(),
  }).strict().optional(),
}).strict();
export const mobileInferenceSecretFields = ['url', 'headers', 'chatgpt'];
