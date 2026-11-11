import { bridgeRequest } from './client';
import type { PublicS3Connection, S3Listing, S3Object } from '../src/s3-protocol';
import { maxS3ObjectBytes } from '../src/s3-limits';
import './style.css';

const select = document.getElementById('connection') as HTMLSelectElement;
const prefix = document.getElementById('prefix') as HTMLInputElement;
const key = document.getElementById('key') as HTMLInputElement;
const file = document.getElementById('file') as HTMLInputElement;
const status = document.getElementById('status')!;
const scope = document.getElementById('scope')!;
const result = document.getElementById('result')!;
const objects = document.getElementById('objects')!;
const download = document.getElementById('download') as HTMLAnchorElement;
const controls = Object.fromEntries(['connect', 'forget', 'list', 'next', 'read', 'upload'].map(id => [id, document.getElementById(id) as HTMLButtonElement]));
const storageKey = `github-ultimate-s3-navigation-v1:${location.pathname}`;
let records: PublicS3Connection[] = [], continuationToken: string | undefined, busy = false, generation = 0, downloadURL: string | undefined;
const selected = () => records.find(record => record.id === select.value);
function report(message: string) { status.textContent = message; }
function clearResult() {
  result.textContent = ''; download.hidden = true;
  if (downloadURL) URL.revokeObjectURL(downloadURL); downloadURL = undefined; download.removeAttribute('href');
}
function update() {
  const record = selected();
  controls.connect.disabled = busy; controls.forget.disabled = busy;
  select.disabled = prefix.disabled = key.disabled = file.disabled = busy;
  controls.list.disabled = busy || !record?.allowRead; controls.next.disabled = controls.list.disabled || !continuationToken;
  controls.read.disabled = busy || !record?.allowRead || !key.value;
  controls.upload.disabled = busy || !record?.allowUpload || !key.value || !file.files?.length;
  scope.textContent = record ? `${record.endpoint} · bucket ${record.bucket} · allowed prefix ${record.prefix || '(whole bucket)'} · ${record.allowOverwrite ? 'Replacement permitted' : 'Create-only uploads; existing keys are not replaced'}` : 'Choose an approved S3 connection.';
}
function remember() {
  if (!selected()) return;
  try { localStorage.setItem(storageKey, JSON.stringify({ connectionId: select.value, prefix: prefix.value, key: key.value })); } catch { /* Optional navigation hints only. */ }
}
async function action(work: (current: () => boolean) => Promise<void>) {
  if (busy) return;
  const current = ++generation; busy = true; update(); report('Waiting for storage…');
  try { await work(() => current === generation); }
  catch (error) { if (current === generation) { clearResult(); objects.replaceChildren(); continuationToken = undefined; report(error instanceof Error ? error.message : 'Object storage request failed.'); } }
  finally { if (current === generation) { busy = false; update(); } }
}
async function list(current: () => boolean, next = false) {
  const record = selected(); if (!record) return;
  const listing = await bridgeRequest<S3Listing>({ operation: 's3List', id: record.id, revision: record.revision, prefix: prefix.value, ...(next && continuationToken ? { continuationToken } : {}) });
  if (!current()) return;
  objects.replaceChildren(); continuationToken = listing.continuationToken;
  for (const object of listing.objects) {
    const row = document.createElement('p'), button = document.createElement('button');
    button.textContent = `${object.key} (${object.size.toLocaleString()} bytes)`;
    button.addEventListener('click', () => { key.value = object.key; clearResult(); remember(); update(); });
    row.append(button); objects.append(row);
  }
  remember(); report(`${listing.objects.length} object(s) loaded.${continuationToken ? ' Another page is available.' : ''}`);
}
async function connect(current: () => boolean) {
  clearResult(); objects.replaceChildren(); continuationToken = undefined;
  records = await bridgeRequest<PublicS3Connection[]>({ operation: 's3Connections' }, 5000);
  if (!current()) return;
  select.replaceChildren(new Option('Choose an S3 connection', ''));
  for (const record of records) select.add(new Option(`${record.name} · ${record.bucket}`, record.id));
  let saved: { connectionId: string; prefix?: string; key?: string } | undefined;
  try {
    const candidate = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (typeof candidate?.connectionId === 'string' && (candidate.prefix === undefined || typeof candidate.prefix === 'string' && candidate.prefix.length <= 1024) && (candidate.key === undefined || typeof candidate.key === 'string' && candidate.key.length <= 1024)) saved = candidate;
  } catch { /* Missing/corrupt hints never block manual selection. */ }
  const record = saved ? records.find(record => record.id === saved!.connectionId) : records.length === 1 ? records[0] : undefined;
  if (saved && !record) throw new Error('The saved S3 connection is unavailable. Choose another connection explicitly; no fallback was used.');
  if (record) {
    select.value = record.id; prefix.value = saved?.prefix ?? record.prefix; key.value = saved?.key ?? '';
    if (record.allowRead) await list(current); else report('Upload connection restored. Choose a file and object key.');
  } else report(records.length ? 'Choose an approved S3 connection.' : 'No S3 connections are approved for this document. Configure the connection and origin/subpath in extension settings, then reload.');
}
controls.connect.addEventListener('click', () => void action(connect));
select.addEventListener('change', () => {
  generation++; const record = selected(); prefix.value = record?.prefix ?? ''; key.value = ''; continuationToken = undefined; clearResult(); objects.replaceChildren(); remember(); update();
  if (record?.allowRead) void action(current => list(current));
});
prefix.addEventListener('input', () => { continuationToken = undefined; objects.replaceChildren(); remember(); update(); });
key.addEventListener('input', () => { clearResult(); remember(); update(); });
file.addEventListener('change', () => { if (file.files?.[0]) key.value = (selected()?.prefix ?? '') + file.files[0].name; remember(); update(); });
controls.list.addEventListener('click', () => void action(current => list(current)));
controls.next.addEventListener('click', () => void action(current => list(current, true)));
controls.read.addEventListener('click', () => void action(async current => {
  clearResult();
  const object = await bridgeRequest<S3Object>({ operation: 's3Read', id: selected()!.id, revision: selected()!.revision, key: key.value });
  if (!current()) return;
  const bytes = Uint8Array.from(atob(object.base64), char => char.charCodeAt(0));
  try { result.textContent = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { result.textContent = `Binary object · ${object.size.toLocaleString()} bytes`; }
  downloadURL = URL.createObjectURL(new Blob([bytes])); download.href = downloadURL; download.download = object.key.split('/').pop() || 'object'; download.hidden = false;
  remember(); report(`Read ${object.key} · ${object.size.toLocaleString()} bytes${object.versionId ? ' · version ' + object.versionId : ''}`);
}));
controls.upload.addEventListener('click', () => void action(async current => {
  clearResult(); const upload = file.files?.[0]; if (!upload) throw new Error('Choose a file.');
  if (upload.size > maxS3ObjectBytes) throw new Error('Choose a file no larger than 8 MiB.');
  const bytes = new Uint8Array(await upload.arrayBuffer()); let raw = '';
  for (let i = 0; i < bytes.length; i += 16384) raw += String.fromCharCode(...bytes.subarray(i, i + 16384));
  const receipt = await bridgeRequest<{ key: string; size: number; etag?: string; versionId?: string }>({ operation: 's3Upload', id: selected()!.id, revision: selected()!.revision, key: key.value, base64: btoa(raw), contentType: upload.type || 'application/octet-stream' });
  if (!current()) return;
  result.textContent = JSON.stringify(receipt, null, 2); file.value = ''; remember(); report('Object uploaded. Receipt returned by the configured S3 service; no intent snapshot or review was submitted.');
}));
controls.forget.addEventListener('click', () => {
  try { localStorage.removeItem(storageKey); } catch { /* Optional preference storage. */ }
  select.value = ''; prefix.value = key.value = file.value = ''; objects.replaceChildren(); continuationToken = undefined; clearResult(); update(); report('Storage selection forgotten.');
});
update(); void action(connect);
