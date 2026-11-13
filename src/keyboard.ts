let installed = false;

/** Register at document_start, before GitHub's window/document shortcut handlers. */
export function isolateExtensionKeyboard(): void {
  if (installed) return;
  installed = true;
  for (const type of ['keydown', 'keypress', 'keyup']) window.addEventListener(type, event => {
    const host = event.composedPath().find(node => node instanceof HTMLElement && node.hasAttribute('data-gu-root')) as HTMLElement | undefined;
    if (!host) return;
    // Keep browser defaults (typing, IME, clipboard, Tab, native dialog Escape),
    // but never let the retargeted Shadow DOM event become a GitHub shortcut.
    host.dispatchEvent(new CustomEvent('gu-key', { detail: event }));
    event.stopImmediatePropagation();
  }, true);
}
