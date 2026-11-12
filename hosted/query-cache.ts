import { QueryClient } from '@tanstack/query-core';
import type { GitTransport } from './workspaces';

/** The host owns durable bytes. Query memory only deduplicates live work. */
export function createQueryTransport(send: GitTransport) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 5 * 60 * 1000 } } });
  const transport: GitTransport = <T>(request: Parameters<GitTransport>[0]) => queries.fetchQuery({
    queryKey: ['workspace-read-v1', request], queryFn: () => send<T>(request),
  });
  return { transport, dispose: () => queries.clear() };
}
