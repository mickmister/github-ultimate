import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import { fetch as expoFetch } from 'expo/fetch';
import { Connections } from '../src/connections';
import { MobileConnectionStore } from '../src/mobile-connection-store';
import { MobileGitHub } from '../src/mobile-github';

export const githubEnabled = Constants.expoConfig?.extra?.githubConnectionsEnabled === true;
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const store = new MobileConnectionStore(AsyncStorage, {
  getItem: key => SecureStore.getItemAsync(key, options),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, options),
  removeItem: key => SecureStore.deleteItemAsync(key, options),
}, randomUUID);
// Expo's fetch has streaming response bodies; RN's legacy fetch does not.
const fetcher: typeof fetch = (input, init) => expoFetch(String(input), { ...init, body: init?.body ?? undefined, signal: init?.signal ?? undefined }) as unknown as Promise<Response>;
const timeout = (ms: number) => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
};
export const github = new MobileGitHub(new Connections(store, fetcher, Date.now, randomUUID, timeout), () => githubEnabled);
