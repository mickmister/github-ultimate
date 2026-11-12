/** Works in browser and Hermes without assuming TextEncoder exists. */
export function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const char of value) { const code = char.codePointAt(0)!; bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4; }
  return bytes;
}
