import DOMPurify from 'dompurify';
import { marked } from 'marked';

export function renderDocumentMarkdown(source: string): string {
  const fragment = DOMPurify.sanitize(marked.parse(source, { async: false, gfm: true }), {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'del', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'input'],
    ALLOWED_ATTR: ['href', 'title', 'class', 'type', 'checked', 'disabled', 'align'],
  });
  for (const link of fragment.querySelectorAll('a')) {
    const href = link.getAttribute('href') ?? '';
    if (!/^(?:https?:\/\/|mailto:)/i.test(href)) link.removeAttribute('href');
    link.target = '_blank'; link.rel = 'noopener noreferrer';
  }
  for (const input of fragment.querySelectorAll('input')) {
    input.type = 'checkbox'; input.disabled = true;
  }
  const container = document.createElement('div'); container.append(fragment);
  return container.innerHTML;
}
