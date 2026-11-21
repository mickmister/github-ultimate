import ts from 'typescript';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';

export interface Diagnostic { rule_id: string; severity: 'error'; file: string; line: number; column: number; message: string; help?: string }
type Presentation = { id: string; kind: 'page' | 'region'; file: string; export: string };
type Feature = { id: string; host: string; hooks: string; hook: string; copy: string; ownedViews: string[]; presentations: Presentation[]; scenarios: string };
export interface Policy {
  schema_version: number; features: Feature[];
  routes: Record<string, { feature: string; parent?: string }>;
  legacyRoutes: Record<string, { owner: string; reason: string }>;
  exceptions: { rule: string; file: string; fingerprint: string; owner: string; reason: string; reviewBy: string }[];
}
const surfaces = ['phone', 'tablet', 'desktop'] as const;
const copyProps = new Set(['label', 'placeholder', 'title', 'alt', 'aria-label', 'accessibilityLabel', 'description', 'helperText']);
// Existing unmigrated routes at f7539a0. New routes cannot opt into this baseline
// by adding a reason in JSON; changing the baseline requires changing the checker.
const legacyRouteFiles = new Set(['index.tsx', 'beads.tsx', 'reviews.tsx', 'reviews.$requestId.tsx'].map(p => `webapp/src/routes/${p}`));
export function checkUI(root: string, policy: Policy): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const fail = (rule_id: string, file: string, message: string, node?: ts.Node) => {
    const sf = node?.getSourceFile();
    const pos = sf && node ? sf.getLineAndCharacterOfPosition(node.getStart()) : { line: 0, character: 0 };
    diagnostics.push({ rule_id, severity: 'error', file, line: pos.line + 1, column: pos.character + 1, message });
  };
  if (policy.schema_version !== 1 || !policy.features?.length || !policy.routes || !policy.legacyRoutes || !Array.isArray(policy.exceptions)) {
    fail('ui/policy-validity', '.github/openlint/ui-contracts.json', 'Expected schema 1 and a nonempty feature/route inventory.'); return diagnostics;
  }
  const paths = (dir: string): string[] => readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap(e => e.isDirectory() ? paths(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
  const routeFiles = paths('webapp/src/routes').filter(p => p.endsWith('.tsx') && !p.endsWith('/__root.tsx'));
  const roots = [...new Set([...paths('webapp/src').filter(p => /\.tsx?$/.test(p)), ...policy.features.flatMap(f => [f.scenarios])])];
  const configPath = resolve(root, 'webapp/tsconfig.json');
  const config = existsSync(configPath) ? ts.readConfigFile(configPath, ts.sys.readFile) : { config: {} };
  if (config.error) throw new Error('Cannot read webapp TypeScript configuration.');
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve(root, 'webapp'));
  const options: ts.CompilerOptions = { ...parsed.options, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, allowImportingTsExtensions: true, noEmit: true, noLib: true, types: [] };
  // This is a repository symbol/import graph, not a second full typecheck. Bind
  // project declarations without repeatedly parsing React/DOM/dependency types.
  // The normal tsc steps remain required in CI.
  const compilerHost = ts.createCompilerHost(options);
  const getSourceFile = compilerHost.getSourceFile.bind(compilerHost);
  compilerHost.getSourceFile = (file, ...args) => file.replaceAll('\\', '/').includes('/node_modules/') || relative(root, file).startsWith('..') ? undefined : getSourceFile(file, ...args);
  const program = ts.createProgram(roots.map(p => resolve(root, p)), options, compilerHost);
  const checker = program.getTypeChecker();
  const source = (file: string) => {
    const sf = program.getSourceFile(resolve(root, file));
    if (!sf) fail('ui/missing-file', file, 'Contract file is missing or cannot be parsed.');
    return sf;
  };
  const walk = (node: ts.Node, visit: (n: ts.Node) => void) => { visit(node); ts.forEachChild(node, n => walk(n, visit)); };
  const implementation = (node: ts.Node): ts.Declaration | undefined => {
    let symbol = checker.getSymbolAtLocation(node);
    const seen = new Set<ts.Symbol>();
    while (symbol && symbol.flags & ts.SymbolFlags.Alias && !seen.has(symbol)) { seen.add(symbol); symbol = checker.getAliasedSymbol(symbol); }
    return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  };
  const fileOf = (node: ts.Node) => relative(root, node.getSourceFile().fileName).replaceAll('\\', '/');
  const imports = (sf: ts.SourceFile) => sf.statements.flatMap(s => {
    if ((!ts.isImportDeclaration(s) && !ts.isExportDeclaration(s)) || !s.moduleSpecifier || !ts.isStringLiteral(s.moduleSpecifier)) return [];
    const found = ts.resolveModuleName(s.moduleSpecifier.text, sf.fileName, program.getCompilerOptions(), ts.sys).resolvedModule;
    return found ? [relative(root, found.resolvedFileName).replaceAll('\\', '/')] : [];
  });
  const reachable = (start: string, target: string, visited = new Set<string>()): boolean => {
    if (start === target) return true;
    if (visited.has(start) || !start.startsWith('webapp/')) return false;
    visited.add(start);
    const sf = program.getSourceFile(resolve(root, start));
    return Boolean(sf && imports(sf).some(p => reachable(p, target, visited)));
  };
  const featureIds = new Set(policy.features.map(f => f.id));
  if (featureIds.size !== policy.features.length) fail('ui/policy-validity', '.github/openlint/ui-contracts.json', 'Duplicate feature IDs.');
  for (const route of routeFiles) {
    const adopted = policy.routes[route], legacy = policy.legacyRoutes[route];
    if (Boolean(adopted) === Boolean(legacy)) fail('ui/route-surfaces', route, 'Every route needs exactly one feature contract or exact existing-route migration record.');
    if (legacy && (!legacy.owner || !legacy.reason)) fail('ui/migration-validity', route, 'Migration requires an owner and reason.');
    if (legacy && !legacyRouteFiles.has(route)) fail('ui/migration-validity', route, 'New routes cannot use the existing-route migration baseline.');
    if (adopted) {
      const feature = policy.features.find(f => f.id === adopted.feature);
      if (!feature || (adopted.parent ? !routeFiles.includes(adopted.parent) || policy.routes[adopted.parent]?.feature !== adopted.feature : !reachable(route, feature.host))) fail('ui/route-surfaces', route, 'Route must reach its registered feature host (or declared adopted parent).');
    }
  }
  for (const p of [...Object.keys(policy.routes), ...Object.keys(policy.legacyRoutes)]) if (!routeFiles.includes(p)) fail('ui/migration-validity', p, 'Unused route inventory entry.');
  const registered = new Set(policy.features.flatMap(f => f.presentations.map(p => p.file)));
  for (const file of roots.filter(f => f.startsWith('webapp/src/'))) {
    const sf = source(file); if (!sf) continue;
    for (const target of imports(sf)) if (target.startsWith('mobile/')) fail('ui/native-settings-ownership', file, 'Hosted source must not import native UI/settings; use the designated host action adapter.');
  }
  const allViews = new Set<string>();
  const presentationIds = new Set<string>();
  for (const feature of policy.features) {
    if (!feature.presentations.some(p => p.kind === 'page')) fail('ui/device-surfaces', feature.host, 'Feature contract needs a registered three-surface page.');
    const host = source(feature.host), hooks = source(feature.hooks), copy = source(feature.copy), scenarios = source(feature.scenarios);
    if (!feature.hooks.endsWith('.hooks.ts')) fail('ui/feature-hooks-boundary', feature.hooks, 'Use a feature-owned .hooks.ts entry.');
    let called = false;
    if (host) walk(host, n => {
      if (!ts.isCallExpression(n)) return;
      const d = implementation(n.expression);
      if (d && fileOf(d) === feature.hooks && 'name' in d && (d.name as ts.Node | undefined)?.getText() === feature.hook) called = true;
      if (/^(?:React\.)?use[A-Z]/.test(n.expression.getText()) && (!d || fileOf(d) !== feature.hooks)) fail('ui/feature-hooks-boundary', feature.host, 'Feature host hooks must come from its declared hooks entry.', n);
    });
    if (!called || !hooks) fail('ui/feature-hooks-boundary', feature.host, 'Host must actually call its feature hook above surface selection.');
    if (copy) walk(copy, n => {
      if (!ts.isObjectLiteralExpression(n) || !n.properties.some(p => p.name?.getText() === 'text')) return;
      const purpose = n.properties.find(p => p.name?.getText() === 'purpose');
      const value = purpose && ts.isPropertyAssignment(purpose) && ts.isStringLiteral(purpose.initializer) ? purpose.initializer.text : '';
      if (!['action', 'label', 'heading', 'status', 'error', 'permission'].includes(value)) fail('ui/contextual-help-only', feature.copy, 'Copy needs an essential purpose; helper prose requires a precise reviewed exception.', n);
    });
    for (const presentation of feature.presentations) {
      if (presentationIds.has(presentation.id)) fail('ui/device-surfaces', presentation.file, 'Presentation IDs must be unique.');
      presentationIds.add(presentation.id);
      const sf = source(presentation.file); if (!sf) continue;
      let definition: ts.ObjectLiteralExpression | undefined;
      walk(sf, n => {
        if (ts.isVariableDeclaration(n) && n.name.getText() === presentation.export && n.initializer && ts.isCallExpression(n.initializer)) {
          const call = n.initializer;
          const factory = implementation(call.expression);
          if (factory && fileOf(factory) === 'webapp/src/presentation/Presentation.tsx' && call.expression.getText() === (presentation.kind === 'page' ? 'defineDevicePage' : 'defineDeviceRegion') && ts.isObjectLiteralExpression(call.arguments[0])) definition = call.arguments[0];
        }
      });
      if (!definition) { fail('ui/device-surfaces', presentation.file, 'Export a literal definition through the approved page/region factory.'); continue; }
      const ids = definition.properties.find(p => p.name?.getText() === 'id');
      if (!ids || !ts.isPropertyAssignment(ids) || !ts.isStringLiteral(ids.initializer) || ids.initializer.text !== presentation.id) fail('ui/device-surfaces', presentation.file, 'Registered ID must match the presentation definition.');
      const symbols = new Set<string>();
      for (const surface of surfaces) {
        const prop = definition.properties.find(p => p.name?.getText() === surface);
        const d = prop && ts.isPropertyAssignment(prop) ? implementation(prop.initializer) : undefined;
        if (!d) { fail('ui/device-surfaces', presentation.file, `Missing resolved ${surface} implementation.`); continue; }
        const file = fileOf(d); allViews.add(file);
        if (!file.endsWith(`.${surface}.view.tsx`)) fail('ui/device-surfaces', file, `Expected a distinct .${surface}.view.tsx implementation.`);
        const identity = `${file}:${d.pos}`;
        if (symbols.has(identity)) fail('ui/device-surfaces', file, 'Surface implementations must resolve to different declarations.');
        symbols.add(identity);
        let ownsMarkup = false;
        walk(d, n => { if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && /^[a-z]/.test(n.tagName.getText())) ownsMarkup = true; });
        if (!ownsMarkup) fail('ui/no-forwarding-device-page', file, 'Surface view must own markup, not alias/forward the complete shared page.');
        if (scenarios) for (const orientation of ['portrait', 'landscape']) {
          // Require an explicit scenario export per surface; metadata alone is not a passing browser test.
          const name = `${surface[0].toUpperCase()}${surface.slice(1)}${orientation[0].toUpperCase()}${orientation.slice(1)}`;
          if (!scenarios.statements.some(s => ts.isVariableStatement(s) && s.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) && s.declarationList.declarations.some(v => v.name.getText() === name))) fail('ui/orientation-coverage', feature.scenarios, `Missing exported ${name} production-component scenario.`);
        }
      }
      if (!reachable(feature.host, presentation.file)) fail('ui/device-surfaces', feature.host, `Feature must actually reach registered presentation ${presentation.id}.`);
    }
    for (const file of feature.ownedViews) allViews.add(file);
  }
  for (const file of roots.filter(f => f.startsWith('webapp/src/'))) {
    const sf = source(file); if (!sf) continue;
    walk(sf, n => {
      if (ts.isCallExpression(n) && /defineDevice(Page|Region)$/.test(n.expression.getText()) && !registered.has(file)) fail('ui/device-surfaces', file, 'Unregistered presentation; declare its feature ownership and coverage.', n);
    });
    if (/\.(phone|tablet|desktop)\.view\.tsx$/.test(file) && !allViews.has(file)) fail('ui/device-surfaces', file, 'Unregistered surface implementation.');
    if (file.endsWith('.view.tsx') && !allViews.has(file)) {
      // Existing leaf views are shared; they may not smuggle cross-surface imports.
      for (const target of imports(sf)) if (/\.(phone|tablet|desktop)\.view\.tsx$/.test(target)) fail('ui/device-page-boundaries', file, 'Shared leaf views cannot import surface implementations.');
    }
  }
  const renderedLiteral = (node: ts.Node, visited = new Set<ts.Node>()): boolean => {
    if (visited.has(node)) return false;
    visited.add(node);
    if (ts.isIdentifier(node)) {
      const d = implementation(node);
      if (d && ts.isVariableDeclaration(d) && d.initializer && !policy.features.some(f => f.copy === fileOf(d))) return renderedLiteral(d.initializer, visited);
    }
    if (ts.isStringLiteralLike(node)) return Boolean(node.text.trim());
    if (ts.isConditionalExpression(node)) return renderedLiteral(node.whenTrue, visited) || renderedLiteral(node.whenFalse, visited);
    if (ts.isBinaryExpression(node)) return renderedLiteral(node.right, visited) || node.operatorToken.kind === ts.SyntaxKind.PlusToken && renderedLiteral(node.left, visited);
    if (ts.isTemplateExpression(node)) return Boolean(node.head.text.trim() || node.templateSpans.some(s => s.literal.text.trim()));
    if (ts.isParenthesizedExpression(node)) return renderedLiteral(node.expression, visited);
    return false;
  };
  for (const file of allViews) {
    const sf = source(file); if (!sf) continue;
    for (const target of imports(sf)) {
      if (/\.(phone|tablet|desktop)\.view\.tsx$/.test(target) && target !== file) fail('ui/device-page-boundaries', file, 'Surface views cannot import another surface implementation.');
      if (target.startsWith('mobile/') || /(?:host|controller|\.hooks|settings)\.(?:ts|tsx)$/.test(target)) fail('ui/view-effects', file, 'View cannot import a native/settings/service/controller implementation.');
    }
    walk(sf, n => {
      if (ts.isCallExpression(n) && /^(?:(?:React|window|globalThis)\.)?(?:use[A-Z]\w*|fetch|matchMedia)$/.test(n.expression.getText())) fail('ui/view-effects', file, 'Move hooks, fetching and layout observation out of views.', n);
      if (ts.isJsxText(n) && n.text.trim() || ts.isJsxExpression(n) && !ts.isJsxAttribute(n.parent) && n.expression && renderedLiteral(n.expression)) fail('ui/no-raw-app-copy', file, 'Use classified feature copy or an explicit content boundary.', n);
      if (ts.isJsxAttribute(n)) {
        if (n.name.getText() === 'helperText') fail('ui/contextual-help-only', file, 'Helper text requires a precise reasoned contextual-help exception.', n);
        if (copyProps.has(n.name.getText()) && n.initializer && (ts.isStringLiteral(n.initializer) || ts.isJsxExpression(n.initializer) && n.initializer.expression && renderedLiteral(n.initializer.expression))) fail('ui/no-raw-app-copy', file, 'Use classified copy for accessible/visible labels.', n);
        if (n.name.getText() === 'tabIndex' && /[1-9]/.test(n.initializer?.getText() ?? '')) fail('ui/accessibility', file, 'Do not use positive tabIndex.', n);
      }
    });
  }
  const used = new Set<number>();
  const remaining = diagnostics.filter(d => {
    const text = existsSync(resolve(root, d.file)) ? readFileSync(resolve(root, d.file), 'utf8').split('\n')[d.line - 1]?.trim() ?? '' : '';
    const fingerprint = createHash('sha256').update(text).digest('hex');
    const i = policy.exceptions.findIndex(e => e.rule === d.rule_id && e.file === d.file && e.fingerprint === fingerprint);
    if (i < 0) return true;
    const e = policy.exceptions[i];
    if (!e.owner || !e.reason || !/^\d{4}-\d{2}-\d{2}$/.test(e.reviewBy) || e.reviewBy < new Date().toISOString().slice(0, 10)) return true;
    used.add(i); return false;
  });
  policy.exceptions.forEach((e, i) => { if (!used.has(i)) remaining.push({ rule_id: 'ui/copy-exception-validity', severity: 'error', file: e.file, line: 1, column: 1, message: 'Unused, invalid or expired exception; remove or reconcile it.' }); });
  return remaining;
}
