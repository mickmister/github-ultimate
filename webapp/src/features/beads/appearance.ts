import { useEffect, useState } from 'react';

// Resolve the application's effective CSS appearance, including explicit saved
// customization and previews, instead of overriding it with device preference.
export function useBeadsAppearance() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const update = () => {
      const root = getComputedStyle(document.documentElement);
      const scheme = root.colorScheme;
      setDark(scheme === 'dark' || (scheme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches));
    };
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true });
    observer.observe(document.head, { childList: true, characterData: true, subtree: true });
    const media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', update); update();
    return () => { observer.disconnect(); media.removeEventListener('change', update); };
  }, []);
  return dark;
}
