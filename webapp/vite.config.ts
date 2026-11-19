import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { uiBuild } from './build-metadata';
import { duckdbAssets } from './duckdb-assets';

export default defineConfig({
  base: process.env.WEBAPP_BASE_PATH ?? '/',
  define: { 'import.meta.env.VITE_UI_BUILD': JSON.stringify(uiBuild) },
  // Start's static-shell prerender uses the physical deployment base. Its
  // client hydration must instead use logical paths within hash history.
  environments: { client: { define: { 'process.env.TSS_ROUTER_BASEPATH': JSON.stringify('/') } } },
  plugins: [
    duckdbAssets(),
    tanstackStart({
      spa: { enabled: true, prerender: { outputPath: '/index.html' } },
    }),
    react(),
  ],
  build: { target: ['chrome120', 'safari16.4'] },
});
