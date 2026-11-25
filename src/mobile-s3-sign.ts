import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { S3ConnectionRecord } from './s3-connections';

function utf8(text: string): Uint8Array {
  const encoded = encodeURIComponent(text), bytes: number[] = [];
  for (let index = 0; index < encoded.length; index++) {
    if (encoded[index] === '%') { bytes.push(parseInt(encoded.slice(index + 1, index + 3), 16)); index += 2; }
    else bytes.push(encoded.charCodeAt(index));
  }
  return Uint8Array.from(bytes);
}
const escape = (text: string) => encodeURIComponent(text).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
/** Native S3 SigV4 uses portable SHA-256/HMAC, without assuming Hermes has WebCrypto. */
export async function mobileS3Sign(record: S3ConnectionRecord, url: URL, init: RequestInit, now = new Date()): Promise<Request> {
  const method = init.method ?? 'GET', date = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const body = init.body instanceof ArrayBuffer ? new Uint8Array(init.body) : init.body ? utf8(String(init.body)) : new Uint8Array();
  const headers = new Headers(init.headers);
  headers.set('host', url.host); headers.set('x-amz-date', date); headers.set('x-amz-content-sha256', bytesToHex(sha256(body)));
  if (record.sessionToken) headers.set('x-amz-security-token', record.sessionToken);
  const names = [...headers.keys()].sort(), signedHeaders = names.join(';');
  const canonicalHeaders = names.map(name => `${name}:${headers.get(name)!.trim().replace(/\s+/g, ' ')}\n`).join('');
  const query = [...url.searchParams].map(([key, value]) => [escape(key), escape(value)]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0).map(pair => pair.join('=')).join('&');
  const pathname = url.pathname.split('/').map(part => escape(decodeURIComponent(part))).join('/');
  const canonical = [method, pathname, query, canonicalHeaders, signedHeaders, headers.get('x-amz-content-sha256')].join('\n');
  const scope = `${date.slice(0, 8)}/${record.region}/s3/aws4_request`;
  let key = utf8(`AWS4${record.secretAccessKey}`);
  for (const value of [date.slice(0, 8), record.region, 's3', 'aws4_request']) key = Uint8Array.from(hmac(sha256, key, utf8(value)));
  const signature = bytesToHex(hmac(sha256, key, utf8(`AWS4-HMAC-SHA256\n${date}\n${scope}\n${bytesToHex(sha256(utf8(canonical)))}`)));
  headers.set('Authorization', `AWS4-HMAC-SHA256 Credential=${record.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`);
  return new Request(url.href, { ...init, headers });
}
