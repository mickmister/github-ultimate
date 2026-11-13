import { bridgeRequest } from '../client';
import type { PageStorageTransport } from '../../src/page-storage';

export function storageAdapter() {
  const request: PageStorageTransport = input => bridgeRequest(input);
  return { request, close() {} };
}
