/** Works in browser and Hermes without assuming TextEncoder exists. */
export function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const char of value) { const code = char.codePointAt(0)!; bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4; }
  return bytes;
}

/** Portable TextEncoder equivalent, replacing unpaired surrogates like UTF-8. */
export function utf8Encode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of text) {
    let code = character.codePointAt(0)!;
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | code >> 6, 0x80 | code & 63);
    else if (code < 0x10000) bytes.push(0xe0 | code >> 12, 0x80 | code >> 6 & 63, 0x80 | code & 63);
    else bytes.push(0xf0 | code >> 18, 0x80 | code >> 12 & 63, 0x80 | code >> 6 & 63, 0x80 | code & 63);
  }
  return Uint8Array.from(bytes);
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
