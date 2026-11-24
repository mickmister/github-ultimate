import type { NextConfig } from "next";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const configDir = dirname(fileURLToPath(import.meta.url));

// GitHub Pages serves a project site from /<repo>/. The workflow passes the
// prefix in PAGES_BASE_PATH; local builds and `next dev` run at the root.
const basePath = (process.env.PAGES_BASE_PATH ?? "").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  output: "export",
  productionBrowserSourceMaps: true,
  basePath,
  trailingSlash: true,
  outputFileTracingRoot: resolve(configDir, '../..'),
  turbopack: { root: resolve(configDir, '../..') },
  images: { unoptimized: true },
  // Next writes AGENTS.md / CLAUDE.md into the project on `next dev` otherwise.
  agentRules: false,
  // `npm run dev` binds 127.0.0.1; Next 16 treats other hosts as cross-origin.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.BUILD_SHA?.slice(0, 8) ?? 'development',
    NEXT_PUBLIC_PI_VERSION: '1.5.2',
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
