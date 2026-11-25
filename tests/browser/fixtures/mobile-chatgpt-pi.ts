import { MobilePiStore } from '../../../src/mobile-pi-store';
import { mobileInferenceRecordSchema, mobileInferenceSecretFields } from '../../../src/mobile-inference-record';
import { InferenceConnections } from '../../../src/inference-connections';
import { MobilePi } from '../../../src/mobile-pi';
import { S3Connections } from '../../../src/s3-connections';

const metadata = new Map<string, string>(), vault = new Map<string, string>();
const store = new MobilePiStore('inference', { getItem: async key => metadata.get(key) ?? null, setItem: async (key, value) => { metadata.set(key, value); } }, { getItem: async key => vault.get(key) ?? null, setItem: async (key, value) => { vault.set(key, value); }, removeItem: async key => { vault.delete(key); } }, () => crypto.randomUUID(), mobileInferenceRecordSchema, mobileInferenceSecretFields);
const state = { approved: false, polls: 0, holdCode: false };
let releaseCode: (() => void) | undefined;
const fetcher: typeof fetch = async url => {
  if (String(url).endsWith('/usercode')) {
    if (state.holdCode) await new Promise<void>(resolve => { releaseCode = resolve; });
    return Response.json({ device_auth_id: 'fixture-device', user_code: 'NATIVE-1234', interval: 1 });
  }
  if (String(url).endsWith('/deviceauth/token')) { state.polls++; return state.approved ? Response.json({ authorization_code: 'fixture-code', code_verifier: 'fixture-verifier' }) : Response.json({}, { status: 403 }); }
  return Response.json({ access_token: `header.${btoa(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'fixture-account' } }))}.fixture-access`, refresh_token: 'fixture-refresh', expires_in: 3600 });
};
export const pi = new MobilePi(new S3Connections({ all: async () => [], get: async () => undefined, put: async () => {}, remove: async () => {} }), new InferenceConnections(store, fetcher));
(window as any).__chatgptFixture = { state, releaseCode: () => releaseCode?.(), list: () => pi.inference.handle({ operation: 'list' }) };
