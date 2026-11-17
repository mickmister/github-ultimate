import { alohakLink } from './mobile-protocol';

/** HTTPS remains shareable; a user gesture opens the exact route in the installed app. */
export function mobileHandoff(href: string, userAgent: string, maxTouchPoints = 0) {
  if (/Alohak\/1/.test(userAgent) || !(/Android|iPhone|iPad|iPod/i.test(userAgent) || /Macintosh/i.test(userAgent) && maxTouchPoints > 1)) return;
  try {
    const entryURL = new URL('.', href).href;
    return { entryURL, appURL: alohakLink(entryURL, href) };
  } catch { return; }
}
