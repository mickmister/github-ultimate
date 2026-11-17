import { sha1 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { GitBlob } from './git-reads';

export const maxBlobBytes = 16 * 1024 * 1024;

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
