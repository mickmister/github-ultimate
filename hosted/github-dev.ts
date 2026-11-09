export function githubDevURL(repository: string, commit: string, path = 'documents', file = false): string {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository) || repository.split('/').some(part => part === '.' || part === '..') || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) throw new Error('A repository and full snapshot commit are required.');
  if (!path || /[\\\0\r\n]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe document path.');
  return `https://github.dev/${repository.split('/').map(encodeURIComponent).join('/')}/${file ? 'blob' : 'tree'}/${commit}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
