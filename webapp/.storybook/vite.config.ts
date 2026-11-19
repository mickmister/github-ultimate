import { defineConfig } from 'vite';
import { duckdbAssets } from '../duckdb-assets';

// Explicit config prevents Storybook from discovering ../vite.config.ts (Start).
export default defineConfig({ plugins: [duckdbAssets()] });
