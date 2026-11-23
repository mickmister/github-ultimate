import { useEffect, useState } from 'react';
import type { MobileGrant } from '../src/mobile-protocol';
import type { PublicS3Connection } from '../src/s3-protocol';
import type { PublicInferenceConnection } from '../src/inference-protocol';
import { pi } from './pi';

export function usePiConnections(grant?: MobileGrant) {
  const [storage, setStorage] = useState<PublicS3Connection[]>([]), [inference, setInference] = useState<PublicInferenceConnection[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [name, setName] = useState(''), [url, setURL] = useState(''), [model, setModel] = useState(''), [headers, setHeaders] = useState('{}');
  const [storageName, setStorageName] = useState(''), [endpoint, setEndpoint] = useState(''), [bucket, setBucket] = useState(''), [prefix, setPrefix] = useState(''), [region, setRegion] = useState('us-east-1');
  const [virtualAddressing, setVirtualAddressing] = useState(false);
  const [accessKeyId, setAccessKeyId] = useState(''), [secretAccessKey, setSecretAccessKey] = useState(''), [sessionToken, setSessionToken] = useState('');
  async function refresh() { setStorage(await pi.s3.handle({ operation: 'list' }) as PublicS3Connection[]); setInference(await pi.inference.handle({ operation: 'list' }) as PublicInferenceConnection[]); }
  useEffect(() => { void refresh().catch(() => setError('Unlock the device to load Pi connections.')); }, []);
  async function action(work: () => Promise<unknown>) {
    if (busy) return; setBusy(true); setError(''); pi.clear();
    try { await work(); await refresh(); }
    catch (cause) { setError(cause instanceof Error && cause.name === 'ConnectionError' ? cause.message : 'Could not update Pi connections. Check native settings and unlock the device.'); }
    finally { setBusy(false); }
  }
  const addInference = () => action(async () => {
    const values = JSON.parse(headers);
    if (!values || Array.isArray(values) || typeof values !== 'object' || Object.values(values).some(value => typeof value !== 'string')) throw Error('Use a JSON object of string headers.');
    await pi.inference.handle({ operation: 'add', name, url, model, headers: Object.entries(values).map(([name, value]) => ({ name, value })) });
    setName(''); setURL(''); setModel(''); setHeaders('{}');
  });
  const addStorage = () => action(async () => {
    await pi.s3.handle({ operation: 'add', name: storageName, endpoint, bucket, prefix, region, addressing: virtualAddressing ? 'virtual' : 'path', accessKeyId, secretAccessKey, sessionToken: sessionToken || undefined, allowRead: true, allowUpload: true, allowOverwrite: false });
    setAccessKeyId(''); setSecretAccessKey(''); setSessionToken(''); setStorageName('');
  });
  const permission = (kind: 's3' | 'inference', id: string, operation: 'grantOrigin' | 'revokeOrigin') => action(() => { if (!grant) throw Error('Set a deployment first.'); return pi[kind].handle({ operation, id, ...grant }); });
  const remove = (kind: 's3' | 'inference', id: string) => action(() => pi[kind].handle({ operation: 'remove', id }));
  return { storage, inference, busy, error, name, url, model, headers, storageName, endpoint, bucket, prefix, region, accessKeyId, secretAccessKey, sessionToken,
    virtualAddressing, setVirtualAddressing, setName, setURL, setModel, setHeaders, setStorageName, setEndpoint, setBucket, setPrefix, setRegion, setAccessKeyId, setSecretAccessKey, setSessionToken, addInference, addStorage, permission, remove };
}
export type PiConnectionsModel = ReturnType<typeof usePiConnections>;
