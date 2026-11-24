import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** Shared by publication and browser URL resolution. Hash the exact branch,
 * including slashes/case/Unicode; the readable prefix is not an identity. */
export function previewDirectory(branch: string): string {
  return `b-${branch.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48)}-${bytesToHex(sha256(new TextEncoder().encode(branch))).slice(0, 16)}`;
}
