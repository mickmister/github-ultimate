/** Portable decoder for host-owned token routing metadata (no Buffer/atob). */
export function base64Bytes(text: string): Uint8Array {
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  if (text.length % 4 || /[^A-Za-z0-9+/]/.test(text.slice(0, text.length - padding)) || text.length < padding + (padding ? 2 : 0)) throw new Error('Invalid base64.');
  const bytes = new Uint8Array(text.length / 4 * 3 - padding);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let buffer = 0, bits = 0, index = 0;
  for (const char of text) {
    if (char === '=') break;
    buffer = (buffer << 6) | alphabet.indexOf(char); bits += 6;
    if (bits >= 8) { bits -= 8; bytes[index++] = (buffer >>> bits) & 255; }
  }
  return bytes;
}
