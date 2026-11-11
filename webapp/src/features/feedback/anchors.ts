import type { FeedbackResource, FeedbackSelection } from './contracts';

export function sameFeedbackResource(left: FeedbackResource | undefined, right: FeedbackResource | undefined) {
  return Boolean(left && right && left.kind === right.kind && left.id === right.id &&
    left.repository === right.repository && left.workspace === right.workspace && left.path === right.path && left.revision === right.revision);
}

const compact = (text: string) => text.replace(/\s/g, '');
function contextScore(before: string, after: string, selection: FeedbackSelection) {
  const prefix = compact(selection.prefix ?? ''), suffix = compact(selection.suffix ?? '');
  before = compact(before); after = compact(after);
  let score = 0;
  for (let i = 1; i <= Math.min(before.length, prefix.length) && before.at(-i) === prefix.at(-i); i++) score++;
  for (let i = 0; i < Math.min(after.length, suffix.length) && after[i] === suffix[i]; i++) score++;
  return score;
}

/** Resolve rendered-text anchors; never guess between equally plausible quotes. */
export function findFeedbackTextRange(text: string, selection: FeedbackSelection): { startOffset: number; endOffset: number } | null {
  const quote = compact(selection.text);
  if (!quote) return null;
  const saved = selection.textRange;
  if (saved && Number.isSafeInteger(saved.startOffset) && Number.isSafeInteger(saved.endOffset) && saved.startOffset >= 0 && saved.endOffset > saved.startOffset && saved.endOffset <= text.length && compact(text.slice(saved.startOffset, saved.endOffset)) === quote) return saved;
  // DOM text and browser-selected text can differ in whitespace between blocks.
  let searchable = '';
  const offsets: number[] = [];
  for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i])) { searchable += text[i]; offsets.push(i); }
  const candidates: { startOffset: number; endOffset: number; score: number }[] = [];
  for (let index = searchable.indexOf(quote); index !== -1; index = searchable.indexOf(quote, index + 1)) {
    const startOffset = offsets[index], endOffset = offsets[index + quote.length - 1] + 1;
    candidates.push({ startOffset, endOffset, score: contextScore(text.slice(Math.max(0, startOffset - 160), startOffset), text.slice(endOffset, endOffset + 160), selection) });
  }
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length || candidates.length > 1 && candidates[0].score === candidates[1].score) return null;
  const { startOffset, endOffset } = candidates[0];
  return { startOffset, endOffset };
}

export function renderedFeedbackRange(root: HTMLElement, selection: FeedbackSelection): Range | null {
  const nodes: Text[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = '';
  while (walker.nextNode()) { const node = walker.currentNode as Text; nodes.push(node); text += node.data; }
  const anchor = findFeedbackTextRange(text, selection);
  if (!anchor) return null;
  const range = root.ownerDocument.createRange();
  let offset = 0, started = false;
  for (const node of nodes) {
    if (!started && anchor.startOffset < offset + node.length) { range.setStart(node, anchor.startOffset - offset); started = true; }
    if (started && anchor.endOffset <= offset + node.length) { range.setEnd(node, anchor.endOffset - offset); return range; }
    offset += node.length;
  }
  return null;
}
