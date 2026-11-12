import { z } from 'zod';
import { sha1 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export const gitOid = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
export const maxBlobBytes = 16 * 1024 * 1024;
export const maxMetadataBytes = 2 * 1024 * 1024;
export const maxBlobResponseBytes = 24 * 1024 * 1024;
export const workspaceName = z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/);
const scope = { id: z.string().uuid(), installationId: z.number().int().positive(), repository: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/).max(220), cacheOnly: z.boolean().optional(), cacheVisit: z.boolean().optional(), namespace: z.enum(['documents', 'dolt']).optional() };
const workspaceScope = { ...scope, workspace: workspaceName };
export const gitReadSchemas = [
  z.object({ operation: z.literal('gitRefs'), ...scope, prefix: z.enum(['documents/', 'dolt/']) }).strict(),
  z.object({ operation: z.literal('gitCommit'), ...workspaceScope, oid: gitOid }).strict(),
  z.object({ operation: z.literal('gitTree'), ...workspaceScope, oid: gitOid }).strict(),
  z.object({ operation: z.literal('gitBlob'), ...workspaceScope, oid: gitOid }).strict(),
] as const;
export const gitReadSchema = z.discriminatedUnion('operation', gitReadSchemas);
export type GitRead = z.infer<typeof gitReadSchema>;
export type GitRef = { ref: string; object: { sha: string; type: 'commit' } };
export type GitCommit = { sha: string; tree: { sha: string } };
export type GitTree = { sha: string; truncated: false; tree: { path: string; mode: string; type: 'blob' | 'tree' | 'commit'; sha: string; size?: number }[] };
export type GitBlob = { sha: string; size: number; encoding: 'base64'; content: string };

// Portable to the native broker: no Node Buffer, atob or WebCrypto dependency.
export function verifiedGitBlobBytes(blob: GitBlob): Uint8Array<ArrayBuffer> {
  const content = blob.content.replace(/\s/g, ''), alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) throw new Error('Invalid Git blob base64.');
  const length = content.length / 4 * 3 - (content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0);
  if (length !== blob.size || length > maxBlobBytes) throw new Error('Git blob size mismatch.');
  const bytes = new Uint8Array(length);
  let bits = 0, buffer = 0, index = 0;
  for (const character of content) {
    if (character === '=') break;
    buffer = (buffer << 6) | alphabet.indexOf(character); bits += 6;
    if (bits >= 8) { bits -= 8; bytes[index++] = (buffer >>> bits) & 255; }
  }
  const header = Uint8Array.from(`blob ${bytes.length}\0`, character => character.charCodeAt(0));
  const hash = (blob.sha.length === 40 ? sha1 : sha256).create().update(header).update(bytes).digest();
  if (bytesToHex(hash) !== blob.sha) throw new Error('Git blob bytes failed integrity verification.');
  return bytes;
}

// Fixed semantic routes only. Repository authorization happens in Connections on
// every call; Git object IDs pin snapshots even when remote refs advance.
export async function readGit(request: GitRead, repository: string, api: (path: string, maxBytes?: number) => Promise<unknown>) {
  const base = `/repos/${repository.split('/').map(encodeURIComponent).join('/')}/git`;
  if (request.operation === 'gitRefs') {
    const refs = z.array(z.object({ ref: z.string().max(256), object: z.object({ sha: gitOid, type: z.literal('commit') }) })).max(5000)
      .parse(await api(`${base}/matching-refs/${request.prefix}`));
    if (refs.some(ref => !ref.ref.startsWith(`refs/${request.prefix}`))) throw new Error('GitHub returned refs outside the requested namespace.');
    return refs;
  }
  if (request.operation === 'gitCommit') {
    const commit = z.object({ sha: gitOid, tree: z.object({ sha: gitOid }) }).parse(await api(`${base}/commits/${request.oid}`));
    if (commit.sha !== request.oid) throw new Error('Git commit identity mismatch.');
    return commit;
  }
  if (request.operation === 'gitTree') {
    const tree = z.object({ sha: gitOid, truncated: z.boolean(), tree: z.array(z.object({
      path: z.string().max(4096), mode: z.string(), type: z.enum(['blob', 'tree', 'commit']), sha: gitOid, size: z.number().int().nonnegative().optional(),
    })).max(10000) }).parse(await api(`${base}/trees/${request.oid}?recursive=1`));
    if (tree.sha !== request.oid) throw new Error('Git tree identity mismatch.');
    if (tree.truncated) throw new Error('GitHub truncated this tree; no partial snapshot was returned.');
    return tree;
  }
  const blob = z.object({ sha: gitOid, size: z.number().int().nonnegative().max(maxBlobBytes), encoding: z.literal('base64'), content: z.string().max(maxBlobResponseBytes) })
    .parse(await api(`${base}/blobs/${request.oid}`, maxBlobResponseBytes));
  if (blob.sha !== request.oid) throw new Error('Git blob identity mismatch.');
  return blob;
}

export async function boundedJSON(response: Response, maxBytes: number): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty GitHub response.');
  const decoder = new TextDecoder();
  let text = '', bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new Error('GitHub response exceeds the read limit.');
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
