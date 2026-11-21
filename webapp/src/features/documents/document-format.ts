export function isMarkdown(path: string): boolean {
  return /\.(?:md|markdown|mdown|mkdn|mkd)$/i.test(path);
}

export function documentLanguage(path: string): string {
  if (isMarkdown(path)) return 'markdown';
  const extension = path.split('.').pop()?.toLowerCase();
  return ({ json: 'json', jsonc: 'json', yaml: 'yaml', yml: 'yaml', js: 'javascript', mjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', css: 'css', html: 'html', xml: 'xml', py: 'python', sh: 'shell', bash: 'shell' } as Record<string, string>)[extension ?? ''] ?? 'plaintext';
}
