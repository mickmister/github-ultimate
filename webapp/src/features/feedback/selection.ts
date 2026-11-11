import type { FeedbackSelection } from './contracts';

const adapters = new WeakMap<HTMLElement, () => FeedbackSelection | null>();
export function registerFeedbackSelection(element: HTMLElement, capture: () => FeedbackSelection | null) {
  adapters.set(element, capture);
  element.dataset.feedbackSelection = 'adapter';
  return () => { adapters.delete(element); delete element.dataset.feedbackSelection; };
}

export function captureFeedbackSelection(root: HTMLElement, representation = 'rendered-text'): FeedbackSelection | null {
  root = root.querySelector<HTMLElement>('[data-feedback-content]') ?? root;
  for (const element of [root, ...root.querySelectorAll<HTMLElement>('[data-feedback-selection]')]) {
    const capture = adapters.get(element);
    if (capture) return capture();
  }
  const active = root.ownerDocument.activeElement;
  if ((active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) && root.contains(active)) {
    if (active instanceof HTMLInputElement && active.type === 'password') return null;
    const start = active.selectionStart, end = active.selectionEnd;
    if (start != null && end != null && end > start) return { text: active.value.slice(start, end), representation: 'input-text' };
  }
  const selection = root.ownerDocument.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const text = selection.toString();
  if (!text) return null;
  const before = range.cloneRange(), after = range.cloneRange();
  before.selectNodeContents(root); before.setEnd(range.startContainer, range.startOffset);
  after.selectNodeContents(root); after.setStart(range.endContainer, range.endOffset);
  const startOffset = before.toString().length;
  return { text, representation, prefix: before.toString().slice(-80), suffix: after.toString().slice(0, 80), textRange: { startOffset, endOffset: startOffset + range.toString().length } };
}
