export type WorkspaceManifest = {
  schema_version: 1; workspace: string; observed_at: string; purpose?: string;
  repositories?: { path: string; branch?: string; commit: string; detached?: boolean; dirty?: boolean; remotes?: { name: string; url: string }[] | null; publication: 'unverified' | 'no_remote' }[] | null;
};

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function safePath(value: unknown) {
  return typeof value === 'string' && value.length > 0 && !/[\\\0\r\n\t]/.test(value) && value.split('/').every(part => part !== '' && part !== '.' && part !== '..' && part.toLowerCase() !== '.git');
}
function timestamp(value: unknown) {
  if (typeof value !== 'string') return false;
  const parts = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:Z|([+-])(\d\d):(\d\d))$/.exec(value);
  if (!parts) return false;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = parts;
  const leap = Number(year) % 4 === 0 && (Number(year) % 100 !== 0 || Number(year) % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= days[Number(month) - 1]
    && Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59
    && (!offsetHour || Number(offsetHour) <= 23 && Number(offsetMinute) <= 59) && Number.isFinite(Date.parse(value));
}

// Schema-v1 contract shared with nugs manifest.go. This parser stays in the
// hosted app; the extension only authorizes and bounds Git object transport.
export function parseWorkspaceManifest(text: string, workspace: string): WorkspaceManifest {
  const bad = () => new Error('Invalid workspace/manifest.json: expected matching schema-v1 identity, timestamp, valid optional repository pointers, and a nonblank purpose when no repositories are attached.');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw bad(); }
  if (!object(value) || value.schema_version !== 1 || value.workspace !== workspace || !timestamp(value.observed_at)) throw bad();
  if (value.purpose != null && typeof value.purpose !== 'string' || value.repositories != null && !Array.isArray(value.repositories)) throw bad();
  const repositories = (value.repositories ?? []) as unknown[];
  if (!repositories.length && (typeof value.purpose !== 'string' || !value.purpose.trim())) throw bad();
  const seen = new Set<string>();
  for (const repository of repositories) {
    if (!object(repository) || repository.path !== '.' && !safePath(repository.path) || typeof repository.path !== 'string' || seen.has(repository.path)) throw bad();
    seen.add(repository.path);
    if (typeof repository.commit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(repository.commit)) throw bad();
    if (repository.detached != null && typeof repository.detached !== 'boolean' || repository.dirty != null && typeof repository.dirty !== 'boolean') throw bad();
    if (repository.detached ? repository.branch != null && repository.branch !== '' : typeof repository.branch !== 'string' || !repository.branch.startsWith('refs/heads/')) throw bad();
    if (repository.publication !== 'unverified' && repository.publication !== 'no_remote' || repository.remotes != null && !Array.isArray(repository.remotes)) throw bad();
    const remotes = (repository.remotes ?? []) as unknown[];
    if ((remotes.length === 0) !== (repository.publication === 'no_remote')) throw bad();
    for (const remote of remotes) {
      if (!object(remote) || typeof remote.name !== 'string' || !remote.name || typeof remote.url !== 'string' || !remote.url) throw bad();
      try {
        const url = new URL(remote.url);
        if (url.password || ['http:', 'https:'].includes(url.protocol) && (url.username || url.search || url.hash)) throw bad();
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Invalid workspace/manifest.json')) throw error;
        // SCP-style Git remotes are valid source pointers too.
      }
    }
  }
  return value as WorkspaceManifest;
}
