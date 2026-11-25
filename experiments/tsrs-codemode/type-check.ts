import { loadModule } from '@tsrs/wasm';
import { makeRequest, memoryFileSystem, parseReply, runTscAsync } from '@tsrs/wasm/core';
import type { CodemodeTool } from '@earendil-works/pi-codemode/portable';
import { z } from 'zod';
import { Scratch, scratchPath } from '../../src/scratch';

const request = z.discriminatedUnion('scope', [
  z.object({ project: scratchPath, scope: z.literal('project') }).strict(),
  z.object({ project: scratchPath, scope: z.literal('files'), files: z.array(scratchPath).min(1).max(20) }).strict(),
]);
const prefix = '/workspace/';
const relative = (path?: string) => path?.startsWith(prefix) ? path.slice(prefix.length) : path;

// Deliberately opt-in: the experiment supports bounded, fully materialized text
// workspaces. It never mistakes a lazy base's partial file cache for a project.
export function typeCheckTool(scratch: Scratch, onPhase: (phase: string) => void): CodemodeTool {
  let running = false;
  return {
    name: 'type_check',
    description: 'Check a materialized scratch tsconfig using tsrs WASM. files filters diagnostics in the full project context, not compiler work. Global/config diagnostics remain visible. Does not emit or change source.',
    inputSchema: z.toJSONSchema(request),
    async execute(input, { signal }) {
      const args = request.parse(input);
      signal.throwIfAborted();
      if (running) throw Error('Only one type check may run at a time.');
      running = true;
      try {
        const snapshot = scratch.snapshot();
        if (snapshot.base) throw Error('Type-check experiment requires a fully materialized workspace; lazy base coverage is incomplete.');
        if (!snapshot.files.some(f => f.path === args.project)) throw Error('Project configuration not found.');
        if (args.scope === 'files' && args.files.some(path => !snapshot.files.some(f => f.path === path))) throw Error('Selected file not found.');
        const files = Object.fromEntries(snapshot.files.map(f => [prefix + f.path, f.content]));
        onPhase('typecheck-started');
        const started = performance.now();
        const module = await loadModule(new URL('./tsrs.wasm', import.meta.url));
        signal.throwIfAborted();
        const stdout: string[] = [], stderr: string[] = [], decoder = new TextDecoder();
        // The published low-level API is the same host used by tsc(). Its
        // beforeRun callback lets the lifecycle tests observe actual WASM entry.
        const result = await runTscAsync(module, makeRequest(['-p', prefix + args.project, '--noEmit', '--noCheck', 'false', '--listFiles'], { cwd: '/workspace', json: true }), memoryFileSystem(files), {
          stdout: bytes => stdout.push(decoder.decode(bytes)), stderr: bytes => stderr.push(decoder.decode(bytes)),
          beforeRun: () => onPhase('compiler-running'),
        });
        signal.throwIfAborted();
        if (result.exitCode === 5) throw Error('Type checker failed: ' + stderr.join('').slice(0, 1000));
        const programFiles = stdout.join('').split(/\r?\n/).filter(path => path.startsWith(prefix)).map(path => relative(path)!);
        const all = parseReply(result.reply);
        if (args.scope === 'files' && args.files.some(path => !programFiles.includes(path))) throw Error('Selected file is outside the configured program; inspect project/configuration diagnostics.');
        const selected = all.filter(d => args.scope === 'project' || !d.fileName || !d.fileName.startsWith(prefix) || d.fileName.endsWith('.json') || args.files.includes(relative(d.fileName)!));
        const diagnostics = selected.slice(0, 100).map(d => ({ file: relative(d.fileName) ?? null, code: d.code, category: d.category, message: d.text.slice(0, 2000), start: d.startPosition, end: d.endPosition }));
        const truncated = selected.length > diagnostics.length || selected.some(d => d.text.length > 2000);
        return {
          engine: '@tsrs/wasm', engineVersion: '7.1.0-beta.tsrs5', typescriptVersion: '7.1.0-beta',
          revision: snapshot.revision, scope: args.scope, project: args.project,
          coverage: 'full configured program; selected scope filters reporting only', programFiles,
          ok: !selected.some(d => d.category === 1) && (result.exitCode === 0 || all.length > 0),
          projectPassed: args.scope === 'project' && result.exitCode === 0 && !truncated,
          complete: !truncated, truncated, exitCode: result.exitCode, diagnostics,
          diagnosticCount: selected.length, projectDiagnosticCount: all.length,
          memoryBytes: result.memoryBytes, durationMs: performance.now() - started,
        };
      } finally { running = false; }
    },
  };
}
