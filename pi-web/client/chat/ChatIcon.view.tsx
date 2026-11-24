export function ChatIcon({ name }: { name: 'draft' | 'refresh' | 'switch' | 'settings' | 'sidebar' | 'close' | 'link' }) {
  const paths = {
    draft: 'M12 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 3l5 5M9 15l1-5L18 2l4 4-8 8-5 1',
    refresh: 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M18 18a8 8 0 0 1-13-3',
    switch: 'M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4',
    settings: 'm9 3-1 3-3 1-2 3 2 2-1 3 3 3 3-1 2 2 3-2 1-3 3-1 1-3-2-2 1-3-3-2-3 1-2-2Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    sidebar: 'M9 3v18M3 3h18v18H3Z',
    close: 'm6 6 12 12M6 18 18 6',
    link: 'm10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
