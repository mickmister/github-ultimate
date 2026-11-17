import { parse } from 'yaml';
import type { ReviewPin } from '../src/review-protocol';

export interface ProcessEvidence { label: string; pin: ReviewPin; metadata: string; error?: string; current?: { pin: ReviewPin; metadata: string } | null }
// Authored frontmatter is evidence, not a second scheduler or completion authority.
export function processMetadata(text: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return 'Metadata missing; methodology position unknown';
  const value = parse(match[1]);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Metadata missing; methodology position unknown';
  const fields = ['pipeline', 'route', 'phase', 'step', 'status', 'approved', 'approved_at', 'created', 'updated'];
  const parts = fields.filter(field => value[field] !== undefined).map(field => `${field}: ${Array.isArray(value[field]) ? value[field].join(' → ') : typeof value[field] === 'object' ? JSON.stringify(value[field]) : String(value[field])}`);
  return parts.length ? parts.join(' · ') : 'Methodology metadata missing; position unknown';
}
