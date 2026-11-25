import type { Metafile } from 'esbuild';
export function buildWorkflowWorker(output: string): Promise<{ define: Record<string, string>; metafile: Metafile }>;
