import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const repository = fileURLToPath(new URL('..', import.meta.url));
export default defineConfig({
  root,
  server: {
    host: '0.0.0.0', port: Number(process.env.PORT || 5173), strictPort: true,
    allowedHosts: ['.jamtools.dev', 'localhost', '127.0.0.1'],
    fs: { allow: [repository] },
    // The managed URL is access-gated and may not proxy Vite WebSockets.
    // In-page CSS controls still update immediately; source-file edits refresh
    // normally. Local development retains ordinary Vite HMR.
    hmr: process.env.PLAYGROUND_PREVIEW ? false : undefined,
  },
  build: { outDir: `${repository}/playground-dist`, emptyOutDir: true },
});
