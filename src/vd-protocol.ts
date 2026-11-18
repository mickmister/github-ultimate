import { z } from 'zod';
import { trustedOrigin } from './hosted-protocol';

export const vdHeaderSchema = z.object({
  name: z.string().trim().regex(/^[!#$%&'*+.^_`|~0-9a-z-]+$/i).max(100),
  mode: z.enum(['plaintext', 'secret']), value: z.string().max(1000).refine(value => !/[\r\n]/.test(value)).optional(),
}).strict();
export const vdDraftSchema = z.object({
  id: z.string().uuid().optional(), name: z.string().trim().min(1).max(80),
  origin: z.string().max(500).transform(value => trustedOrigin(value.trim())),
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/).max(220),
  workspace: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/),
  workspaceId: z.string().uuid(), headers: z.array(vdHeaderSchema).max(12),
}).strict();
export const vdSettingsSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('list') }).strict(),
  z.object({ operation: z.enum(['save', 'test']), draft: vdDraftSchema }).strict(),
  z.object({ operation: z.literal('remove'), id: z.string().uuid() }).strict(),
  z.object({ operation: z.enum(['grantOrigin', 'revokeOrigin']), id: z.string().uuid(), origin: z.string().max(500), subpath: z.string().max(1000) }).strict(),
]);
export type VdDraft = z.input<typeof vdDraftSchema>;
export type VdSettingsRequest = z.input<typeof vdSettingsSchema>;
export type VdHeader = { name: string; mode: 'plaintext' | 'secret'; value: string };
export type PublicVdConnection = Omit<z.output<typeof vdDraftSchema>, 'id' | 'headers'> & {
  id: string; revision: string;
  headers: { name: string; mode: 'plaintext' | 'secret'; configured: boolean; value?: string }[];
  hostedGrants: { origin: string; subpath: string }[];
};
