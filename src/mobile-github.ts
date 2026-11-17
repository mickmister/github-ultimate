import { Connections, ConnectionError, type ConnectionRequest } from './connections';
import { hostedRequestSchema } from './hosted-protocol';
import { MobileReviewTransfers } from './mobile-review-transfer';
import { ZodError } from 'zod';

export const mobileGitHubCapabilities = ['connections', 'repositories', 'probe', 'gitRefs', 'gitCommit', 'gitTree', 'gitBlob', 'gitBlobPart', 'implicitWorkspaces', 'rememberNavigation', 'reviewWrite', 'qrspiProcessReview', 'qrspiWorkflowProgress', 'mobileReviewTransfer'];
const operations = new Set(['discover', 'connections', 'repositories', 'probe', 'gitRefs', 'gitCommit', 'gitTree', 'gitBlob', 'gitBlobPart', 'loadNavigation', 'saveNavigation', 'forgetNavigation', 'documentCache', 'reviewWrite', 'reviewProgress']);

/** Settings stay native-only; hosted calls reuse the shared bounded GitHub engine. */
export class MobileGitHub {
  private epoch = 0;
  private transfers = new MobileReviewTransfers();
  constructor(private connections: Connections, private enabled: () => boolean) {}
  async settings(request: ConnectionRequest) {
    if (!this.enabled() && !['list', 'disconnect', 'remove', 'revokeOrigin', 'cacheSettings', 'saveCacheSettings'].includes(request.operation)) throw new ConnectionError('GitHub connections are disabled in this release. Apply a GitHub-enabled preview update.');
    // Invalidate disclosure immediately, before an in-flight HTTP operation
    // releases the engine's serialized queue to a revoke/disconnect operation.
    if (['disconnect', 'remove', 'revokeOrigin', 'selectInstallation'].includes(request.operation)) { this.epoch++; this.cancelTransfers(); }
    try { return await this.connections.handle(request); }
    catch (cause) { throw this.publicError(cause); }
  }
  async hosted(documentURL: string, input: unknown, current: () => boolean) {
    if (!this.enabled()) throw new ConnectionError('GitHub connections are disabled in this release. Apply a GitHub-enabled preview update.');
    try {
      const request = hostedRequestSchema.parse(input);
      if (!operations.has(request.operation)) throw new ConnectionError('This operation is not available through the mobile GitHub bridge.');
      const epoch = this.epoch;
      const result = await this.connections.handleHosted(documentURL, request, () => this.enabled() && current() && epoch === this.epoch);
      return request.operation === 'discover' ? { protocolVersion: 1, capabilities: [...mobileGitHubCapabilities, ...(result as { capabilities: string[] }).capabilities.filter(capability => ['persistedWorkspaceCache', 'documentSnapshots'].includes(capability))] } : result;
    } catch (cause) { throw this.publicError(cause); }
  }
  cancelTransfers() { this.transfers.clear(); }
  async transfer(documentURL: string, input: unknown, current: () => boolean) {
    if (!this.enabled()) throw new ConnectionError('GitHub connections are disabled in this release.');
    const epoch = this.epoch;
    try {
      return await this.transfers.handle(documentURL, input, () => this.enabled() && current() && epoch === this.epoch,
        (request, originalCurrent) => this.hosted(documentURL, request, originalCurrent));
    } catch (cause) { throw new ConnectionError(cause instanceof Error && !(cause instanceof ZodError) ? cause.message : 'Native review transfer is invalid.'); }
  }
  private publicError(cause: unknown) {
    // JSON/OS/schema diagnostics can include fragments of the value that failed.
    // Only the engine's deliberately public errors may cross the host boundary.
    return cause instanceof ConnectionError ? cause : new ConnectionError('Native GitHub storage or response is unavailable. Unlock the device, check the connection and retry.');
  }
}
