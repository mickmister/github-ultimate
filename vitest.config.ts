import { defineConfig } from 'vitest/config';
// Build/CLI integration tests launch child processes; bound parallelism so
// Start's shell build doesn't starve the other subprocess-based checks.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], maxWorkers: 2 } });
