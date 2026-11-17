/** Works in browser and Hermes without assuming TextEncoder exists. */
export function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const char of value) { const code = char.codePointAt(0)!; bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4; }
  return bytes;
}

/** Strict UTF-8 decoding also works when the native runtime lacks TextDecoder. */
export function utf8Text(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  // The URI decoder implements strict UTF-8, including overlong/surrogate checks.
  // No argument spreading: a bounded response can still exceed engine call limits.
  try { return decodeURIComponent(Array.from(bytes, byte => `%${byte.toString(16).padStart(2, '0')}`).join('')).replace(/^\uFEFF/, ''); }
  catch { throw new Error('Invalid UTF-8.'); }
}
