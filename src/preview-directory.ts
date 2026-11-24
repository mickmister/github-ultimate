import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** Browser counterpart of the dependency-free publisher, with parity tests.
 * Hash the exact branch, including slashes/case/Unicode; the readable prefix is
 * not an identity. The publisher uses Node crypto without installing packages. */
export function previewDirectory(branch: string): string {
  return `b-${branch.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48)}-${bytesToHex(sha256(new TextEncoder().encode(branch))).slice(0, 16)}`;
}
