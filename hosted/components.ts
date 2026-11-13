export function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function externalLink(text: string, href: string) {
  const link = element('a', text, 'button'); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; return link;
}
