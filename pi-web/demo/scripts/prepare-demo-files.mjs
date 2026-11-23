#!/usr/bin/env node
// Publish only the reviewed public fixture list. Never enumerate the enclosing
// Git repository: this application is vendored inside a larger workspace.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const demoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = resolve(demoDir, "..");
const outDir = join(demoDir, "public", "demo-files");
const assetDir = join(outDir, "f");
const MAX_FILE_BYTES = 4 * 1024 * 1024;
// Keep extensions only where the browser needs the right content type to
// render the file directly (<img>, <audio>, <iframe>); text is served as .txt.
const MEDIA_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp", ".avif", ".pdf", ".mp3", ".wav", ".ogg", ".m4a", ".mp4", ".webm", ".mov", ".docx"]);

const fixtures = JSON.parse(readFileSync(join(demoDir, "fixtures/files.json"), "utf8"));
const root = realpathSync(repoDir) + sep;
const seen = new Set();
const sources = fixtures.map(({ path, source = path }) => {
  if (typeof path !== "string" || !path || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..") || seen.has(path)) {
    throw new Error(`Invalid or duplicate demo fixture path: ${path}`);
  }
  seen.add(path);
  const input = realpathSync(resolve(repoDir, source));
  const stat = statSync(input);
  if (!input.startsWith(root) || !stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error(`Invalid demo fixture source: ${source}`);
  return { path, input, size: stat.size };
});

rmSync(outDir, { recursive: true, force: true });
mkdirSync(assetDir, { recursive: true });

const files = [];
for (const { path, input, size } of sources.sort((a, b) => a.path.localeCompare(b.path))) {
  const ext = extname(path);
  const asset = createHash("sha1").update(path).digest("hex").slice(0, 16) + (MEDIA_EXT.has(ext.toLowerCase()) ? ext.toLowerCase() : ".txt");
  copyFileSync(input, join(assetDir, asset));
  files.push({ path, size, asset });
}

writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ files }));
console.log(`[demo] copied ${files.length} project files into public/demo-files`);
