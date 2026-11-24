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

/** Incremental UTF-8 for Hermes as well as browser hosts; retains at most three
 * incomplete bytes between reads, never half of a Unicode scalar. */
export class UTF8Decoder {
  private pending: Uint8Array<ArrayBuffer> = new Uint8Array();
  private started = false;
  decode(chunk: Uint8Array = new Uint8Array(), { stream = false } = {}) {
    const bytes = new Uint8Array(this.pending.length + chunk.length);
    bytes.set(this.pending); bytes.set(chunk, this.pending.length);
    let end = bytes.length;
    if (stream && end) {
      let lead = end - 1;
      while (lead > 0 && (bytes[lead] & 0xc0) === 0x80 && end - lead < 4) lead--;
      const first = bytes[lead], expected = first >= 0xc2 && first <= 0xdf ? 2 : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 1;
      if (end - lead < expected) end = lead;
    }
    let text = utf8Text(bytes.subarray(0, end));
    // utf8Text strips a leading BOM; only the first one is a stream signature.
    if (this.started && end >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) text = '\uFEFF' + text;
    if (end) this.started = true;
    this.pending = bytes.slice(end);
    return text;
  }
}
