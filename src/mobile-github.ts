import { Connections, ConnectionError, type ConnectionRequest } from './connections';
import { hostedRequestSchema } from './hosted-protocol';

export const mobileGitHubCapabilities = ['connections', 'repositories', 'probe', 'gitRefs', 'gitCommit', 'gitTree', 'gitBlob', 'implicitWorkspaces', 'rememberNavigation'];
const reads = new Set(['discover', 'connections', 'repositories', 'probe', 'gitRefs', 'gitCommit', 'gitTree', 'gitBlob', 'loadNavigation', 'saveNavigation', 'forgetNavigation']);

/** Native settings are the only caller of settings(); page RPC can only read. */
export class MobileGitHub {
  private epoch = 0;
  constructor(private connections: Connections, private enabled: () => boolean) {}
  async settings(request: ConnectionRequest) {
    if (!this.enabled() && !['list', 'disconnect', 'remove', 'revokeOrigin', 'cacheSettings', 'saveCacheSettings'].includes(request.operation)) throw new ConnectionError('GitHub connections are disabled in this build pending device isolation acceptance.');
    // Invalidate disclosure immediately, before an in-flight HTTP operation
    // releases the engine's serialized queue to a revoke/disconnect operation.
    if (['disconnect', 'remove', 'revokeOrigin', 'selectInstallation'].includes(request.operation)) this.epoch++;
    try { return await this.connections.handle(request); }
    catch (cause) { throw this.publicError(cause); }
  }
  async hosted(documentURL: string, input: unknown, current: () => boolean) {
    if (!this.enabled()) throw new ConnectionError('GitHub connections are disabled in this build pending device isolation acceptance.');
    try {
      const request = hostedRequestSchema.parse(input);
      if (!reads.has(request.operation)) throw new ConnectionError('Only GitHub connection discovery and repository reads are available in Alohak.');
      const epoch = this.epoch;
      const result = await this.connections.handleHosted(documentURL, request, () => this.enabled() && current() && epoch === this.epoch);
      return request.operation === 'discover' ? { protocolVersion: 1, capabilities: [...mobileGitHubCapabilities, ...((result as { capabilities: string[] }).capabilities.includes('persistedWorkspaceCache') ? ['persistedWorkspaceCache'] : [])] } : result;
    } catch (cause) { throw this.publicError(cause); }
  }
  private publicError(cause: unknown) {
    // JSON/OS/schema diagnostics can include fragments of the value that failed.
    // Only the engine's deliberately public errors may cross the host boundary.
    return cause instanceof ConnectionError ? cause : new ConnectionError('Native GitHub storage or response is unavailable. Unlock the device, check the connection and retry.');
  }
}
