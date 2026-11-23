import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import { fetch as expoFetch } from 'expo/fetch';
import { z } from 'zod';
import { MobilePiStore } from '../src/mobile-pi-store';
import { MobilePi } from '../src/mobile-pi';
import { S3Connections } from '../src/s3-connections';
import { InferenceConnections } from '../src/inference-connections';
import { s3ConfigurationSchema } from '../src/s3-protocol';
import { inferenceConfigurationSchema } from '../src/inference-protocol';
import { mobileS3Sign } from '../src/mobile-s3-sign';

const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const vault = { getItem: (key: string) => SecureStore.getItemAsync(key, options), setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value, options), removeItem: (key: string) => SecureStore.deleteItemAsync(key, options) };
const identity = { id: z.string().uuid(), revision: z.string().uuid(), hostedGrants: z.array(z.object({ origin: z.string(), subpath: z.string() }).strict()) };
const s3Store = new MobilePiStore('s3', AsyncStorage, vault, randomUUID, s3ConfigurationSchema.extend(identity).strict(), ['accessKeyId', 'secretAccessKey', 'sessionToken']);
const inferenceStore = new MobilePiStore('inference', AsyncStorage, vault, randomUUID, inferenceConfigurationSchema.extend(identity).strict(), ['url', 'headers']);
const fetcher: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  return expoFetch(request.url, { ...init, method: request.method, headers: request.headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(), signal: request.signal }) as unknown as Promise<Response>;
};
const timeout = (ms: number) => { const controller = new AbortController(); setTimeout(() => controller.abort(), ms); return controller.signal; };
const combine = (signals: AbortSignal[]) => {
  const controller = new AbortController();
  const abort = () => { controller.abort(); for (const signal of signals) signal.removeEventListener('abort', abort); };
  for (const signal of signals) { if (signal.aborted) { abort(); break; } signal.addEventListener('abort', abort, { once: true }); }
  return controller.signal;
};
export const pi = new MobilePi(new S3Connections(s3Store, fetcher, undefined, undefined, randomUUID, mobileS3Sign, timeout), new InferenceConnections(inferenceStore, fetcher, undefined, randomUUID, timeout, combine));
