import { z } from 'zod';
import { previewDirectory } from '../src/preview-directory';
import { documentText, WorkspaceReader, type GitTransport } from './workspaces';
import type { WorkspaceManifest } from './manifest';
import type { HostedConnection, HostedRequest } from '../src/hosted-protocol';
import { workspaceNavigationSchema, type WorkspaceNavigation } from '../src/workspace-navigation';
import type { ChatWorkspace } from './pi-chat-contract';

const name = z.string().min(1).max(100);
const providerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('github-pages'), baseUrl: z.string().max(2000), path: z.string().max(2000) }).strict(),
  // An explicit template supports Cloudflare Pages/Workers and custom providers
  // without pretending their branch aliases follow GU's publication convention.
  z.object({ kind: z.literal('url-template'), url: z.string().max(4000) }).strict(),
]);
export const workspaceConfigSchema = z.object({
  schema_version: z.literal(1),
  repositories: z.array(z.object({
    repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/).max(220),
    previewSlots: z.array(z.object({ id: name.regex(/^[a-zA-Z0-9_-]+$/), title: name, service: name, enabled: z.boolean().default(true), provider: providerSchema }).strict()).max(50),
  }).strict()).max(100),
}).strict().superRefine((config, ctx) => {
  const repos = new Set<string>();
  for (const repo of config.repositories) {
    const key = repo.repository.toLowerCase();
    if (repos.has(key) || new Set(repo.previewSlots.map(slot => slot.id)).size !== repo.previewSlots.length) ctx.addIssue({ code: 'custom', message: 'Repository and per-repository slot IDs must be unique.' });
    repos.add(key);
  }
});
export type WorkspaceConfig = z.infer<typeof workspaceConfigSchema>;
export type PreviewContext = { repository: string; workspace: string; branch?: string };
export type PreviewProvider = z.infer<typeof providerSchema>;
export type PreviewSlot = { id: string; title: string; service: string; repository: string; url?: string; error?: string };
export type PreviewCatalog = { workspace?: string; version?: string; slots: PreviewSlot[]; workspaces?: ChatWorkspace[]; navigation?: WorkspaceNavigation };

function webURL(value: string): URL {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('Preview URLs must be HTTP(S) without credentials.');
  return url;
}
function template(value: string, context: PreviewContext): string {
  const [owner, repository] = context.repository.split('/');
  const variables: Record<string, string | undefined> = { workspace: context.workspace, branch: context.branch, owner, repository, previewDirectory: context.branch ? previewDirectory(context.branch) : undefined };
  const result = value.replace(/\{([^{}]+)\}/g, (_, key: string) => {
    if (!Object.hasOwn(variables, key) || variables[key] === undefined) throw Error(`Preview placeholder {${key}} has no value.`);
    return encodeURIComponent(variables[key]!);
  });
  if (/[{}]/.test(result)) throw Error('Invalid preview URL template.');
  return result;
}
/** Provider implementations create canonical URLs only; they do not deploy or
 * start a service. Add a provider here without changing config loading or UI. */
export function previewURL(provider: PreviewProvider, context: PreviewContext): string {
  if (provider.kind === 'url-template') return webURL(template(provider.url, context)).href;
  const base = webURL(provider.baseUrl);
  if (base.search || base.hash || !base.pathname.endsWith('/')) throw Error('GitHub Pages baseUrl must be a directory URL.');
  const path = template(provider.path, context);
  if (path.startsWith('/') || path.includes('\\') || path.split('/').some(part => part === '.' || part === '..')) throw Error('GitHub Pages path must be relative to its base URL.');
  const url = webURL(new URL(path, base).href);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw Error('Preview path escaped the GitHub Pages site.');
  return url.href;
}
function githubRepository(remote: string): string | undefined {
  const scp = /^git@github\.com:([\w.-]+\/[\w.-]+)$/.exec(remote);
  if (scp) return scp[1].replace(/\.git$/, '').toLowerCase();
  try { const url = new URL(remote); if (url.hostname !== 'github.com' || url.password || url.search || url.hash) return; return url.pathname.replace(/^\//, '').replace(/\/$/, '').replace(/\.git$/, '').toLowerCase(); } catch { return; }
}
export function resolvePreviewSlots(config: WorkspaceConfig, manifest: WorkspaceManifest): PreviewSlot[] {
  return config.repositories.flatMap(repo => {
    const pointers = (manifest.repositories ?? []).filter(pointer => pointer.remotes?.some(remote => githubRepository(remote.url) === repo.repository.toLowerCase()));
    return repo.previewSlots.filter(slot => slot.enabled).map(slot => {
      const result: PreviewSlot = { id: `${repo.repository}:${slot.id}`, title: slot.title, service: slot.service, repository: repo.repository };
      try {
        if (pointers.length !== 1) throw Error('Preview repository must match exactly one workspace manifest entry.');
        const pointer = pointers[0];
        result.url = previewURL(slot.provider, { repository: repo.repository, workspace: manifest.workspace, branch: pointer.branch?.replace(/^refs\/heads\//, '') });
      } catch (error) { result.error = error instanceof Error ? error.message : 'Preview URL is unavailable.'; }
      return result;
    });
  });
}
type Send = <T>(request: HostedRequest) => Promise<T>;
export async function loadPreviewSlots(send: Send, search: string): Promise<PreviewCatalog> {
  const params = new URLSearchParams(search), explicit = ['connection', 'repository', 'workspace'].some(key => params.has(key));
  const connections = await send<HostedConnection[]>({ operation: 'connections' });
  let selected = connections.find(item => item.id === params.get('connection'));
  // A shared workspace URL carries remote identity, not another device's local
  // connection UUID. Resolve a unique locally authorized connection for its store.
  if (explicit && !selected && params.get('repository')) {
    const candidates = await Promise.all(connections.filter(item => item.installation).map(async connection => {
      try { const repositories = await send<{ full_name: string }[]>({ operation: 'repositories', id: connection.id }); return repositories.some(repo => repo.full_name.toLowerCase() === params.get('repository')!.toLowerCase()) ? connection : undefined; }
      catch { return undefined; }
    }));
    const available = candidates.filter((item): item is HostedConnection => Boolean(item));
    if (available.length !== 1) throw Error('Choose an authorized GitHub connection for this workspace in Documents.');
    selected = available[0];
  }
  const context = explicit ? { connectionId: selected?.id, repository: params.get('repository'), workspace: params.get('workspace'), installationId: params.has('installation') ? Number(params.get('installation')) : selected?.installation?.id } : await send<unknown>({ operation: 'loadNavigation' });
  if (!context) return { slots: [] };
  const parsed = workspaceNavigationSchema.safeParse(context);
  if (!parsed.success) throw Error('Choose a nugs workspace in Documents, then retry previews.');
  const navigation = parsed.data;
  const connection = connections.find(item => item.id === navigation.connectionId && item.installation?.id === navigation.installationId);
  if (!connection) throw Error('Select an authorized nugs workspace in Documents, then retry previews.');
  const reader = new WorkspaceReader(send as GitTransport, connection.id, navigation.repository, navigation.installationId, navigation.workspace);
  const discovered = await reader.discover();
  const workspaces = discovered.filter(item => item.documents).map(item => ({ repository: navigation.repository, workspace: item.name }));
  const workspace = discovered.find(item => item.name === navigation.workspace);
  if (!workspace) throw Error('The selected nugs workspace is no longer available.');
  const { manifest, snapshot } = await reader.open(workspace);
  const entry = snapshot.tree.tree.find(item => item.path === 'documents/workspace-config.json');
  if (!entry) return { workspace: navigation.workspace, slots: [], workspaces, navigation };
  if (entry.size === undefined || entry.size > 64 * 1024) throw Error('workspace-config.json exceeds 64 KiB.');
  const text = documentText(await reader.blob(entry));
  let config: WorkspaceConfig;
  try { config = workspaceConfigSchema.parse(JSON.parse(text)); }
  catch { throw Error('Invalid workspace-config.json. Check the schema and preview provider definitions.'); }
  if (explicit) await send({ operation: 'saveNavigation', navigation });
  return { workspace: navigation.workspace, version: entry.sha, slots: resolvePreviewSlots(config, manifest), workspaces, navigation };
}
