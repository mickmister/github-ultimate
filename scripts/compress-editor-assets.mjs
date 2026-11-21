import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import ts from 'typescript';

// Static Pages cannot set Content-Encoding. Keep stable ESM entry URLs with tiny
// loaders for the two large, lazy editor modules. Rebase parsed imports and
// import.meta.url before importing the decoded module from a local blob. Do not
// rewrite arbitrary text/regex literals or snapshot mutable application exports.
export function compressedEditorModule(code, filename) {
  const sf = ts.createSourceFile(filename, code, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  if (sf.parseDiagnostics.length) throw new Error(`Cannot parse editor module ${filename}`);
  const token = '__GHU_EDITOR_ASSET_BASE__';
  if (code.includes(token)) throw new Error('Editor asset placeholder collision.');
  const edits = [], exports = [];
  const walk = node => {
    if (ts.isExportDeclaration(node)) {
      if (!node.exportClause || !ts.isNamedExports(node.exportClause)) throw new Error('Unsupported editor export.');
      exports.push(...node.exportClause.elements.map(e => e.name.text));
    }
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const specifier = node.moduleSpecifier;
      if (specifier.text.startsWith('.')) edits.push({ start: specifier.getStart(sf), end: specifier.end, text: JSON.stringify(token + specifier.text) });
    }
    if (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression) && node.name.text === 'url') {
      edits.push({ start: node.getStart(sf), end: node.end, text: JSON.stringify(token + filename) });
      return;
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (!argument) throw new Error('Missing editor import source.');
      if (ts.isStringLiteral(argument)) {
        if (argument.text.startsWith('.')) edits.push({ start: argument.getStart(sf), end: argument.end, text: JSON.stringify(token + argument.text) });
      } else {
        edits.push({ start: argument.getStart(sf), end: argument.getStart(sf), text: 'new URL(' });
        edits.push({ start: argument.end, end: argument.end, text: ',' + JSON.stringify(token + filename) + ').href' });
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  for (const edit of edits.sort((a, b) => b.start - a.start)) code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
  const declarations = exports.map((name, index) => `const e${index}=mod[${JSON.stringify(name)}];`).join('');
  const bindings = exports.map((name, index) => `e${index} as ${name}`).join(',');
  const loader = `const base=new URL('.',import.meta.url).href,r=await fetch(new URL(${JSON.stringify(filename + '.gz')},base),{credentials:'omit',redirect:'error'});if(!r.ok||!r.body)throw Error('Editor asset unavailable');const code=(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text()).replaceAll(${JSON.stringify(token)},base),url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));let mod;try{mod=await import(url)}finally{URL.revokeObjectURL(url)}${declarations}export{${bindings}};`;
  return { loader, compressed: gzipSync(code, { level: 9 }) };
}

export async function compressEditorAssets(directory) {
  for (const filename of await readdir(directory)) {
    if (!/^(monaco-runtime|jsonMode)-[\w-]+\.js$/.test(filename)) continue;
    const file = join(directory, filename), code = await readFile(file, 'utf8');
    if (code.startsWith('const base=new URL')) continue;
    const { loader, compressed } = compressedEditorModule(code, filename);
    await writeFile(file + '.gz', compressed);
    await writeFile(file, loader);
  }
}
