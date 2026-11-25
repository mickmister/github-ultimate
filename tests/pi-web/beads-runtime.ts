import type { Page } from '@playwright/test';
import { build } from 'esbuild';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Real Pi, storage, codemode and shared Beads owner; invented engine data only. */
export async function beadsRuntime(page: Page, hold = false) {
  const worker = (await readdir('hosted-dist/pi-web')).find(file => /^workflow-worker-.*\.js$/.test(file))!;
  const result = await build({ stdin: { contents: `
    import { createPiWebRuntime } from './hosted/pi-web-runtime';
    import { PiBeads } from './hosted/pi-beads';
    import { bridgeRequest } from './hosted/client';
    const records = [
      {id:'demo-1',title:'Improve workspace navigation',status:'open',priority:1,issue_type:'epic',labels:['ui'],description:'Detailed epic from the Beads tool'},
      {id:'demo-2',title:'Retain mobile draft',status:'in_progress',priority:2,issue_type:'task',labels:['mobile'],description:'Detailed mobile task'},
      {id:'demo-3',title:'Verify context restore',status:'blocked',priority:2,issue_type:'task',labels:['mobile']}
    ];
    const open = async (scope, signal) => {
      window.beadsLoads = (window.beadsLoads || 0) + 1;
      if (window.holdBeads) await new Promise(resolve => { window.releaseBeads = resolve; });
      signal.throwIfAborted();
      return {gitCommit:'a'.repeat(40),doltCommit:'fixture',root:'root',storageRoot:'storage',fileCount:1,encodedBytes:1,
        state:async()=>({sealed:true,putRejected:true,commitRejected:true,heapAllocBytes:1,heapSysBytes:1}),
        query:async operation=>({operation,request:{},durationMs:0,issues:operation==='list'?records:operation==='ready'?[records[0]]:[records[2]]}),dispose(){} };
    };
    window.piWebExtension = createPiWebRuntime(new PiBeads(bridgeRequest, open));
  `, resolveDir: resolve('.') }, bundle: true, format: 'esm', platform: 'browser', target: ['chrome120', 'safari16.4'], write: false, define: { WORKFLOW_WORKER_URL: JSON.stringify(`./${worker}`) } });
  await page.route('**/extension-runtime.js?*', route => route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text }));
  await page.addInitScript(held => {
    Object.assign(window, { holdBeads: held });
    window.githubUltimateStorageAdapter = { protocolVersion: 1, backend: 'browser', async request(input) {
      const snapshot = JSON.parse(localStorage.getItem('fixture-beads-settings') ?? '{"revision":0,"entries":[]}');
      if (input.operation === 'kvSnapshot') return snapshot;
      const entries = new Map<string, string>(snapshot.entries);
      if (input.operation === 'kvSet') entries.set(input.key, input.value);
      if (input.operation === 'kvRemove') entries.delete(input.key);
      if (input.operation === 'kvClear') entries.clear();
      const next = { revision: snapshot.revision + 1, entries: [...entries] };
      localStorage.setItem('fixture-beads-settings', JSON.stringify(next)); return next;
    } };
  }, hold);
}
