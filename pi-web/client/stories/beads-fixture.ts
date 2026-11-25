import { HydratedPageStorage } from '../../../src/page-storage';
import { emptyPageKV, mutatePageKV } from '../../../src/page-kv';
import type { PiBeadsHandle, PiBeadsSnapshot } from '../../../hosted/pi-beads';
export const fixtureWorkspace = { repository: 'example/storage', workspace: 'storybook-workspace' };
const issues = [
  { id: 'demo-1', title: 'Improve workspace navigation', status: 'open', priority: 1, issue_type: 'epic', labels: ['ui'], description: 'Invented epic for the component story.' },
  { id: 'demo-2', title: 'Retain mobile draft', status: 'in_progress', priority: 2, issue_type: 'task', labels: ['mobile'], description: 'Invented task for the component story.' },
  { id: 'demo-3', title: 'Verify context restore', status: 'blocked', priority: 2, issue_type: 'task', labels: ['mobile'], description: 'Invented blocked task.' },
];
const state: PiBeadsSnapshot = { phase: 'ready', workspace: fixtureWorkspace, error: '', results: ['list', 'ready', 'blocked'].map(operation => ({ operation: operation as 'list' | 'ready' | 'blocked', issues: operation === 'list' ? issues : operation === 'ready' ? [issues[0]] : [issues[2]], request: {}, durationMs: 0 })) };
const handle: PiBeadsHandle = { snapshot: () => state, subscribe: () => () => {}, refresh: () => {}, query: async () => ({ issues }) };
let snapshot = emptyPageKV();
const preferences = HydratedPageStorage.open(async input => { snapshot = mutatePageKV(snapshot, input); return snapshot; });
export const storyBeadsHost = async () => ({ beads: () => handle, preferences: () => preferences });
