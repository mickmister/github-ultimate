export interface MarkdownChange {
  kind: 'unchanged' | 'added' | 'removed';
  blocks: string[];
}

/** Compare whole rendered blocks so lists, tables and fenced code stay valid HTML. */
export function diffMarkdownBlocks(before: readonly string[], after: readonly string[]): MarkdownChange[] {
  const changes: MarkdownChange[] = [];
  const append = (kind: MarkdownChange['kind'], blocks: readonly string[]) => {
    if (!blocks.length) return;
    const last = changes.at(-1);
    if (last?.kind === kind) last.blocks.push(...blocks);
    else changes.push({ kind, blocks: [...blocks] });
  };
  let start = 0, endBefore = before.length, endAfter = after.length;
  while (start < endBefore && start < endAfter && before[start] === after[start]) start++;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter--; }
  append('unchanged', before.slice(0, start));
  const rows = endBefore - start, columns = endAfter - start, width = columns + 1;
  // Bound memory/work for very large rewrites. Common leading/trailing blocks
  // still remain unchanged; the middle is shown as a complete replacement.
  if ((rows + 1) * width > 1_000_000) {
    append('removed', before.slice(start, endBefore));
    append('added', after.slice(start, endAfter));
  } else {
    const lengths = new Uint32Array((rows + 1) * width);
    for (let i = rows - 1; i >= 0; i--) for (let j = columns - 1; j >= 0; j--) {
      lengths[i * width + j] = before[start + i] === after[start + j]
        ? 1 + lengths[(i + 1) * width + j + 1]
        : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    }
    let i = 0, j = 0;
    while (i < rows || j < columns) {
      if (i < rows && j < columns && before[start + i] === after[start + j]) {
        append('unchanged', [before[start + i++]]); j++;
      } else if (i < rows && (j === columns || lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])) {
        append('removed', [before[start + i++]]);
      } else append('added', [after[start + j++]]);
    }
  }
  append('unchanged', before.slice(endBefore));
  return changes;
}
