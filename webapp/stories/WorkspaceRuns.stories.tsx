import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ComponentProps } from 'react';
import { WorkflowRunsView } from '../src/features/runs/WorkflowRuns.view';
import { PresentationProvider } from '../src/presentation/Presentation';
import type { Presentation } from '../src/presentation/geometry';

const noop = () => {};
const scope = { connectionId: 'fixture-connection', installationId: 1, repository: 'example/storage', workspace: 'workspace-a' };
const pointer = { schema_version: 1 as const, repository: 'example/gh-agentic-workflows', github_run_id: '20', github_run_attempt: '1', github_job_instance: 'worker', workspace_ref: 'ws-' + 'a'.repeat(32), association: 'execution-used-workspace' as const, payload_key: 'observability/github/example/gh-agentic-workflows/20-1/worker/payload.tgz', bytes: 1500, sha256: 'b'.repeat(64), verified: true as const, bucket: 'private-telemetry', prefix: 'pilot' };
const run = { key: 'example/gh-agentic-workflows/20/1', repository: pointer.repository, run: 20, attempt: 1, pointers: [pointer], sources: [], metadata: { id: 20, run_attempt: 1, name: 'Agent workflow', display_title: 'Review implementation evidence', created_at: '2026-11-18T00:00:00Z', run_started_at: '2026-11-18T00:00:10Z', status: 'completed', conclusion: 'success', head_sha: 'c'.repeat(40), head_branch: 'feature/review', html_url: 'https://github.com/example/gh-agentic-workflows/actions/runs/20' } };
const args: ComponentProps<typeof WorkflowRunsView> = {
  connections: [{ id: scope.connectionId, name: 'Personal', installationId: 1, account: 'example' }], connectionId: scope.connectionId, actionsId: scope.connectionId, scope,
  storage: { repository: scope.repository, workspace: scope.workspace, repositories: [{ fullName: scope.repository, private: true }], workspaces: ['workspace-a', 'workspace-b'], repositoriesBusy: false, workspacesBusy: false, repositoryError: '', workspaceError: '', canListRepositories: true, clearConnection: noop, chooseRepository: noop, chooseWorkspace: noop, retry: noop },
  inventory: { snapshot: 'a'.repeat(40), workspaceRef: pointer.workspace_ref, runs: [run], notices: ['Legacy associations contain only published post-job exports.'] }, rows: [run], total: 1,
  reviews: [], s3: [], s3Id: '', job: 'worker', query: 'SELECT name, duration_ms FROM spans', error: '', busy: false, queryBusy: false, filter: '', statusFilter: '', page: 0, timings: { [run.key]: '10.0 s · job window' },
  actions: { setConnection: noop, setRepository: noop, setWorkspace: noop, setActions: noop, load: noop, open: noop, back: noop, setS3: noop, setJob: noop, setQuery: noop, runQuery: noop, loadTelemetry: noop, loadOutputs: noop, cancel: noop, setFilter: noop, setStatus: noop, setPage: noop },
};
const meta = { title: 'Workflows/Workspace runs', component: WorkflowRunsView, args, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof WorkflowRunsView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AssociatedRuns: Story = {};
export const AttemptWithQuery: Story = { args: {
  selected: run,
  detail: { jobs: [{ id: 1, name: 'worker', status: 'completed', conclusion: 'success', started_at: '2026-11-18T00:00:10Z', completed_at: '2026-11-18T00:00:20Z' }], artifacts: [], errors: [] },
  dataset: { signals: ['traces'], warnings: ['One selected job loaded; other signals were not captured.'], tables: { spans: [{ job_instance: 'worker', name: 'model turn', duration_ms: 100, status_code: 0 }], span_events: [], span_links: [], logs: [], metrics: [] } },
  result: { columns: ['name', 'duration_ms'], rows: [['model turn', '100']], truncated: false },
  reviews: [{ label: 'produced-review-request', title: 'Exact review evidence', pin: { resource: 'review-requests/example/request.json', version_kind: 'git-blob', version: 'd'.repeat(40), snapshot: 'a'.repeat(40) } }],
} };
export const InaccessibleEvidence: Story = { args: { selected: run, error: 'S3 returned HTTP 403. Check access and endpoint compatibility.', detail: { artifacts: undefined, jobs: undefined, errors: ['Actions read permission is unavailable. No fallback connection was used.'] } } };
const surface = (value: Presentation): Story => ({ render: props => <PresentationProvider value={value}><WorkflowRunsView {...props} /></PresentationProvider> });
export const PhonePortrait: Story = surface({ surface: 'phone', orientation: 'portrait' });
export const PhoneLandscape: Story = surface({ surface: 'phone', orientation: 'landscape' });
export const TabletPortrait: Story = surface({ surface: 'tablet', orientation: 'portrait' });
export const TabletLandscape: Story = surface({ surface: 'tablet', orientation: 'landscape' });
export const DesktopPortrait: Story = surface({ surface: 'desktop', orientation: 'portrait' });
export const DesktopLandscape: Story = surface({ surface: 'desktop', orientation: 'landscape' });
