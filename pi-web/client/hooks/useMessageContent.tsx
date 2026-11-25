"use client";
import { createContext, useContext } from 'react';

/** Optional display-only loaders supplied by the owning runtime. Renderers never
 * choose network endpoints, credentials or a Node session/filesystem API. */
export interface MessageContentLoaders {
  thinking?: (sessionId: string, entryId: string, blockIndex: number) => Promise<string>;
  output?: (sessionId: string, path: string) => Promise<string>;
}
const context = createContext<MessageContentLoaders>({});
export const MessageContentProvider = context.Provider;
export function useMessageContent() { return useContext(context); }
