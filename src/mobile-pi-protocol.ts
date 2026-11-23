export const mobilePiMethod = 'pi.transfer';
export const mobilePiChunkChars = 2000;
export const mobilePiMaxBytes = 12 * 1024 * 1024;
export function splitPiText(text: string) {
  const parts: string[] = [];
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + mobilePiChunkChars, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    parts.push(text.slice(offset, end)); offset = end;
  }
  return parts;
}
