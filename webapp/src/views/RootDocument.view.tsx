import type { ReactNode } from 'react';
import { HeadContent, Scripts } from '@tanstack/react-router';
import '../styles.css';

export function RootDocument({ children }: { children: ReactNode }) {
  return <html lang="en"><head><HeadContent /></head><body>{children}<Scripts /></body></html>;
}
