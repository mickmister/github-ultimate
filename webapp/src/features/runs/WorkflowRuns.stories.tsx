import type { Meta, StoryObj } from '@storybook/react-vite';
import { WorkflowRunsView } from './WorkflowRuns.view';

const noop = () => {};
const scope = { connectionId: 'fixture', installationId: 1, repository: 'example/storage', workspace: 'workspace-a' };
const run = { key: 'example/gh-agentic-workflows/20/1', repository: 'example/gh-agentic-workflows', run: 20, attempt: 1, pointers: [], sources: [], metadata: { id: 20, run_attempt: 1, name: 'Agent work', display_title: 'Inspect the failing build', created_at: '2026-11-18T00:00:00Z', status: 'completed', conclusion: 'success', head_sha: 'a'.repeat(40), head_branch: 'feature/work', html_url: 'https://github.com/example/gh-agentic-workflows/actions/runs/20' } };
const meta = {
  title: 'Workflows/Workspace runs', component: WorkflowRunsView,
  args: { scope, connections: [{ id: 'fixture', installationId: 1, name: 'GitHub', account: 'example' }], connectionId: 'fixture', actionsId: 'fixture',
    storage: { repository: scope.repository, workspace: scope.workspace, repositories: [{ fullName: scope.repository, private: true }], workspaces: [scope.workspace], repositoriesBusy: false, workspacesBusy: false, repositoryError: '', workspaceError: '', canListRepositories: true, clearConnection: noop, chooseRepository: noop, chooseWorkspace: noop, retry: noop },
    inventory: { snapshot: 'a'.repeat(40), runs: [run], notices: ['Only explicit workspace associations are shown.'] }, rows: [run], total: 1,
    reviews: [], s3: [], s3Id: '', job: '', query: '', error: '', busy: false, queryBusy: false, filter: '', statusFilter: '', page: 0, timings: { [run.key]: '10.0 s · job window' },
    actions: { setConnection: noop, setRepository: noop, setWorkspace: noop, setActions: noop, load: noop, open: noop, back: noop, setS3: noop, setJob: noop, setQuery: noop, runQuery: noop, loadTelemetry: noop, loadOutputs: noop, cancel: noop, setFilter: noop, setStatus: noop, setPage: noop } },
} satisfies Meta<typeof WorkflowRunsView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AssociatedRuns: Story = {};
export const EmptyWorkspace: Story = { args: { inventory: { snapshot: 'a'.repeat(40), runs: [], notices: ['Unassociated runs are not guessed from branch names.'] }, rows: [], total: 0 } };
export const InaccessibleMetadata: Story = { args: { error: 'Actions read access is required on this repository.' } };
export const AttemptWithoutTelemetry: Story = { args: { selected: run, detail: { jobs: [], artifacts: [], errors: [] } } };
