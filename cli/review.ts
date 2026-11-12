import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { parseRecord } from '../src/protocol.ts';
import { attachedFormDSL, reviewBeadMetadata } from '../src/review-beads.ts';
import { artifactResource, parseReviewArtifact, parseReviewRequest, requestResource, validateReviewArtifact, type ReviewPin } from '../src/review-protocol.ts';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  workspace: { type: 'string' }, file: { type: 'string' }, expected: { type: 'string' },
  repository: { type: 'string' }, 'app-url': { type: 'string' }, root: { type: 'string' },
  request: { type: 'string' }, watch: { type: 'boolean', default: false },
  bead: { type: 'string' }, form: { type: 'string' },
  'until-response': { type: 'boolean', default: false },
} });
const workspace = values.workspace;
if (!workspace) throw new Error('Pass --workspace <stored workspace handle>.');
const bin = process.env.NUGS_BIN ?? 'nugs';
const root = values.root ? resolve(values.root) : process.cwd();
type Resource = { name: string; version: string; commit: string; uri: string };
type Document = Resource & { text: string };
function nugs(action: string, args: string[] = [], input?: string): any {
  return JSON.parse(execFileSync(bin, ['documents', action, '--workspace', workspace!, ...args], { cwd: root, encoding: 'utf8', input, maxBuffer: 32 * 1024 * 1024 }));
}
function listing(): Resource[] { return nugs('list').resources ?? []; }
function read(name: string, snapshot?: string): Document {
  return nugs('read', ['--name', name, ...(snapshot ? ['--snapshot', snapshot] : [])]).document;
}
async function readPin(pin: ReviewPin) {
  const document = read(pin.resource, pin.snapshot);
  if (document.version !== pin.version) throw new Error(`Pinned version mismatch: ${pin.resource}`);
  return document.text;
}
function save(name: string, text: string, expected?: string): Resource {
  const receipt = nugs('upsert', ['--name', name, '--file', '-', ...(expected ? ['--expected', expected] : [])], text).receipt as Resource;
  const verified = read(name, receipt.commit);
  if (verified.version !== receipt.version || verified.text !== text) throw new Error('Document publication failed readback verification.');
  return receipt;
}
async function main() {
  if (positionals[0] === 'list') {
    const result = listing().filter(resource => /^review-requests\/[^/]+\/request\.json$/.test(resource.name)).map(resource => {
      const request = parseReviewRequest(read(resource.name, resource.commit).text);
      if (request.workspace !== workspace || requestResource(request.request_id) !== resource.name) throw new Error('Request identity mismatch.');
      return { request, receipt: resource };
    });
    console.log(JSON.stringify(result, null, 2));
  } else if (positionals[0] === 'import-form') {
    if (!values.bead || !values.form || !values.request || !values.root) throw new Error('Import requires --root, --bead, --form and --request.');
    const bead = JSON.parse(execFileSync('bd', ['show', values.bead, '--json'], { cwd: root, encoding: 'utf8' }))[0];
    const form = bead.metadata?.beadForms?.forms?.find((form: any) => form.id === values.form);
    if (!form) throw new Error('Attached form was not found.');
    const dsl = attachedFormDSL(form);
    const requestPath = requestResource(values.request);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(values.form)) throw new Error('Unsafe form ID.');
    const receipt = save(requestPath.replace('request.json', `forms/${values.form}.json`), JSON.stringify(dsl, null, 2) + '\n', values.expected);
    console.log(JSON.stringify({ bead_id: values.bead, form_id: dsl.id, receipt }, null, 2));
  } else if (positionals[0] === 'publish') {
    if (!values.file || !values.repository || !values['app-url']) throw new Error('Publish requires --file, --repository and --app-url.');
    const url = new URL(values['app-url']);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Expected a public HTTP(S) app URL.');
    const input = JSON.parse(readFileSync(values.file, 'utf8'));
    input.revision_id ??= `revision-${crypto.randomUUID()}`;
    const request = parseReviewRequest(JSON.stringify(input));
    if (request.workspace !== workspace) throw new Error('Request workspace does not match --workspace.');
    const resources = listing();
    const current = resources.find(resource => resource.name === requestResource(request.request_id));
    if ((current?.version ?? undefined) !== values.expected) throw new Error('Publish requires the observed --expected version; omit it only for a new request.');
    if (current) {
      const previous = parseReviewRequest(read(current.name, current.commit).text);
      if (previous.revision_id === request.revision_id) throw new Error('Amendments require a fresh revision_id (or omit it to generate one).');
      for (const resource of resources.filter(resource => resource.name.startsWith(`review-requests/${request.request_id}/responses/`) && resource.name.endsWith('.json') && !resource.name.endsWith('.bead.json'))) {
        const response = parseReviewArtifact(read(resource.name, resource.commit).text);
        if (response.kind === 'review-response' && response.request.version === current.version && request.status !== 'withdrawn') throw new Error('This revision has responses. Publish a linked follow-up request.');
      }
    }
    for (const member of request.members) {
      if (member.kind === 'document') { await readPin(member.target); if (member.baseline) await readPin(member.baseline); }
      else {
        const form = parseRecord(await readPin(member.dsl));
        if (!('format' in form) || form.id !== member.form_id || form.task_id && form.task_id !== member.bead_id || form.invalidatedAt) throw new Error(`Invalid pinned form identity: ${member.id}`);
      }
    }
    const receipt = save(requestResource(request.request_id), JSON.stringify(request, null, 2) + '\n', values.expected);
    const search = new URLSearchParams({ repository: values.repository, workspace, version: receipt.version, snapshot: receipt.commit });
    url.hash = `/reviews/${request.request_id}?${search}`;
    console.log(JSON.stringify({ request_id: request.request_id, receipt, link: url.href }, null, 2));
  } else if (positionals[0] === 'ingest') {
    if (!values.root) throw new Error('Ingest requires --root pointing to the workspace Beads root.');
    do {
      let ingested = 0;
      let resources: Resource[];
      try { resources = listing(); }
      catch (error) {
        if (!values.watch) throw error;
        console.error(error instanceof Error ? error.message : String(error));
        await new Promise(resolve => setTimeout(resolve, 15000));
        continue;
      }
      for (const resource of resources.filter(resource => /^review-requests\/[^/]+\/responses\/[^/]+\.json$/.test(resource.name) && !resource.name.endsWith('.bead.json'))) {
        try {
        const value = parseReviewArtifact(read(resource.name, resource.commit).text);
        if (value.kind !== 'review-response' || values.request && value.request.id !== values.request) continue;
        if (artifactResource(value) !== resource.name) throw new Error('Response path identity mismatch.');
        const ackName = resource.name.replace(/\.json$/, '.bead.json');
        const acknowledged = resources.find(resource => resource.name === ackName);
        const request = parseReviewRequest(await readPin({ resource: requestResource(value.request.id), version_kind: 'git-blob', version: value.request.version, snapshot: value.request.snapshot }));
        if (request.workspace !== workspace) throw new Error('Response request workspace mismatch.');
        await validateReviewArtifact(request, value, readPin);
        const marker = `[review-response:${value.id}:${resource.version}]`;
        const beadIds = [...new Set([request.bead_id, ...value.forms.map(form => form.bead_id)])];
        const beadState = (id: string) => JSON.parse(execFileSync('bd', ['show', id, '--json'], { cwd: root, encoding: 'utf8' }))[0];
        if (acknowledged && beadIds.every(id => {
          const pointers = beadState(id).metadata?.reviewResponsePointers;
          return Array.isArray(pointers) && pointers.some((pointer: any) => pointer.responseId === value.id && pointer.version === resource.version);
        })) continue;
        for (const beadId of beadIds) {
          const comments = execFileSync('bd', ['comments', beadId, '--json'], { cwd: root, encoding: 'utf8' });
          // The marker bridges a crash between Bead update and acknowledgement save.
          if (!comments.includes(marker)) execFileSync('bd', ['comments', 'add', beadId,
            `${marker}\nReview response saved for request ${value.request.id}, manifest ${value.request.version}.\nAuthoritative answers: ${resource.uri}\nResponse version: ${resource.version}; snapshot: ${resource.commit}.\nForms: ${value.forms.map(form => `${form.bead_id}/${form.form_id} (${form.intent})`).join(', ') || 'none'}; comments: ${value.comments.length}.`], { cwd: root, stdio: 'pipe' });
          const bead = beadState(beadId);
          const patch = await reviewBeadMetadata(beadId, bead.metadata ?? {}, value, { uri: resource.uri, version: resource.version, snapshot: resource.commit }, readPin);
          const latest = beadState(beadId);
          if (!isDeepStrictEqual(latest.metadata, bead.metadata)) throw new Error(`Bead metadata changed during intake: ${beadId}. Retry; no metadata was overwritten.`);
          // --set-metadata treats values as strings in current bd releases.
          // Preserve observed metadata and write structured JSON, then read back.
          execFileSync('bd', ['update', beadId, '--add-label', 'needs-agent-review', '--metadata', JSON.stringify({ ...bead.metadata, ...patch })], { cwd: root, stdio: 'pipe' });
          const verified = beadState(beadId).metadata;
          if (!isDeepStrictEqual(verified.reviewResponsePointers, patch.reviewResponsePointers) || !isDeepStrictEqual(verified.beadFormsSummary, patch.beadFormsSummary)) throw new Error(`Bead pointer readback mismatch: ${beadId}. No acknowledgement was issued.`);
        }
        const ack = save(ackName, JSON.stringify({ kind: 'review-bead-ack', schema_version: 1, response_id: value.id, response_version: resource.version, request_id: value.request.id, bead_id: request.bead_id, marker }, null, 2) + '\n', acknowledged?.version);
        console.log(JSON.stringify({ response: resource, bead_id: request.bead_id, acknowledgement: ack }));
        ingested++;
        } catch (error) {
          console.error(JSON.stringify({ resource: resource.name, error: error instanceof Error ? error.message : String(error) }));
          if (!values.watch) process.exitCode = 1;
        }
      }
      if (values['until-response'] && ingested) break;
      if (values.watch) await new Promise(resolve => setTimeout(resolve, 15000));
    } while (values.watch);
  } else throw new Error('Usage: pnpm review list|import-form|publish|ingest --workspace <handle> [options]. NUGS_BIN selects the nugs executable.');
}
await main();
