# Browser type checking through Pi codemode

This opt-in experiment proves a real `type_check` capability called from
`@earendil-works/pi-codemode/portable` **1.5.2**, using the published
`@tsrs/wasm` **7.1.0-beta.tsrs5** checker. It reuses the application's actual
`Scratch` and `scratchTools` implementations. Ownership: **task-93j.7**.

## Run

From the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec playwright install chromium webkit
pnpm run test:tsrs
```

The Playwright suite builds the browser entries with esbuild and serves them from
a nested static path with the two published WASM binaries. It verifies browser
export selection and exercises Chromium and WebKit with
`crossOriginIsolated === false`. Trace, screenshot and video capture are disabled.
Generated files stay under ignored `test-results/`.

## Actual execution boundary

```text
Playwright → browser test host → one owned module Worker
  ├─ Pi InlineCodemodeSandbox → QuickJS WASM (32 MiB VM heap)
  │    └─ await tools.type_check(...) → JSON capability bridge
  ├─ production scratchTools + an execution-local Scratch clone
  └─ tsrs WASM outside QuickJS → semantic diagnostics → QuickJS text(...)
```

Pi's VM, capability dispatch, schemas, error handling and call records are real.
No model inference is needed: the test supplies deterministic codemode scripts.
The experimental host implements success-only overlay application with the same
revision guard as `hosted/scratch-execution.ts`; it does not replace or modify the
production worker. `type_check` is not registered in the shipped app yet.

Example script in that sandbox:

```js
const f = await tools.read_file({ path: 'src/model.ts' });
await tools.write_file({
  path: f.path,
  content: 'export const value: string = "changed";',
  expectedRevision: f.revision,
});
text(await tools.type_check({
  project: 'tsconfig.json', scope: 'files', files: ['src/use.ts'],
}));
text(await tools.type_check({ project: 'tsconfig.json', scope: 'project' }));
```

`scope: files` runs the full configured program and filters **reported**
diagnostics. It retains config/global diagnostics and verifies selected files
belong to the program. It is not a reduced-work or isolated-root optimization.
An internally valid changed export can pass a selected-file report while breaking
its consumers; only a complete successful project report sets `projectPassed`.

Compiler errors are data, not tool transport errors. A successful codemode script
can keep its edits despite type errors. Throwing explicitly discards all edits.
Invalid requests, unsupported inputs, failed compilation or stale overlay
application cannot masquerade as a project pass.

## Engine and lifecycle

`type-check.ts` uses the published `loadModule` and `@tsrs/wasm/core` APIs. The core
host is the implementation underneath the package's browser `tsc()` API; its
`beforeRun` callback exposes entry to synchronous WASM checking for lifecycle
tests. JSON diagnostics and the `--listFiles` program membership are collected in
memory. Standard-library declarations are bundled with tsrs; test dependency
types are ordinary virtual `node_modules` files.

The checker shares the **browser worker**, not QuickJS's restricted global
environment or its 32 MiB heap. Tests confirm QuickJS still has no ambient
`fetch`, `process` or `WebAssembly`. Compilation is synchronous, so the VM's
interrupt budget cannot interrupt the checker. A separate page-side deadline
or cancel action terminates the owning worker. There are no nested compiler
workers to leak. Tests interrupt loading, timeout a blocked load, and cancel
after the real WASM `beforeRun` boundary while the page remains responsive.

Each invocation gets a fresh compiler instance; compiled module loading is cached
within that worker. Source, emitted files and build caches are not written to the
repository filesystem. `--noEmit` is forced, and `--noCheck false` prevents a
project config from silently disabling semantic checking. Other project checking
options remain effective. No arbitrary compiler flags are exposed to scripts.

## Supported bounds

- Fully materialized regular UTF-8 scratch files only: existing Scratch limits
  of 100 files, 128 KiB per file and 512 KiB total. Lazy Git-backed workspaces are
  rejected explicitly, even when they contain a local overlay.
- One configured tsconfig program, inherited configs, relative/aliased imports
  and supplied dependency declarations. No package downloads or automatic type
  acquisition; missing modules produce diagnostics. Project-reference build
  orchestration and framework-generated declarations are outside this experiment.
- Selected reports accept at most 20 paths. Concurrent type-check calls are
  rejected. Scripts are bounded to 32 KiB and a supervised execution deadline.
- At most 100 reported diagnostics, with 2,000-character message excerpts.
  Larger results set `truncated: true`, `complete: false`; compiler error counts
  are computed before truncation. Positions are zero-based UTF-16.
- Reported `memoryBytes` is WASM linear memory, including the shadow stack, not
  total browser memory. TypeScript compatibility is **7.1.0-beta**; do not infer
  TS 5/6 configuration equivalence from these fixtures.

## Verified scenarios

The suite has **11 scenarios in each browser (22 total)**:

1. Same-script edits, inherited configuration/alias resolution, selected versus
   project diagnostics, repair, diff and successful overlay application.
2. Missing package types, package.json/declaration resolution, and UTF-16 locations.
3. Explicit script failure rolls back edits after a real compiler result.
4. Invalid paths/options, empty/missing selections and files excluded by tsconfig.
5. `noCheck` bypass prevention and actual configuration diagnostics.
6. Global diagnostics survive selected filtering; large results declare truncation.
7. Incomplete lazy bases and oversized writes are rejected.
8. Cancellation during WASM loading, rollback and a successful subsequent check.
9. Outer timeout during blocked loading, rollback and recovery.
10. A concurrent page-side edit prevents stale overlay application.
11. Cancellation after synchronous compiler entry with a 9,000-declaration
    workload, responsive page, rollback and recovery.

These checks establish a browser-codemode engine bridge and transaction behavior.
They are not a physical iPhone test, a large-repository benchmark, warm incremental
performance evidence or a model-driven end-to-end application session. The main
product integration work is acquiring a complete versioned project/type-file
closure from the lazy workspace without routing those contents through the model.
