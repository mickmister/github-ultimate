import { z } from 'zod';

// Preferences only. Never store manifests, document contents or credentials.
export const workspaceNavigationSchema = z.object({
  connectionId: z.string().uuid(),
  installationId: z.number().int().positive(),
  repository: z.string().regex(/^(?!\.{1,2}\/)[a-zA-Z0-9_.-]+\/(?!\.{1,2}$)[a-zA-Z0-9_.-]+$/).max(220),
  workspace: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/),
  documentId: z.string().min(1).max(1000).optional(),
  documentPath: z.string().min(1).max(1000).optional(),
}).strict();
export type WorkspaceNavigation = z.infer<typeof workspaceNavigationSchema>;
