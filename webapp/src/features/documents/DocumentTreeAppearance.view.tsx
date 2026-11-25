import type { DocumentBrowserProps } from './contracts';
import { copy } from './Documents.copy';

export function DocumentTreeAppearance({ model, actions }: DocumentBrowserProps) {
  return <details className="tree-appearance"><summary>{copy.treeAppearance}</summary>
    <label>{copy.density}<select value={model.treeAppearance.density} onChange={e => actions.setTreeAppearance({ ...model.treeAppearance, density: e.target.value === 'compact' ? 'compact' : 'comfortable' })}><option value="comfortable">{copy.comfortable}</option><option value="compact">{copy.compact}</option></select></label>
    <label>{copy.accent}<select value={model.treeAppearance.accent} onChange={e => actions.setTreeAppearance({ ...model.treeAppearance, accent: e.target.value === 'blue' ? 'blue' : e.target.value === 'teal' ? 'teal' : 'default' })}><option value="default">{copy.default}</option><option value="blue">{copy.blue}</option><option value="teal">{copy.teal}</option></select></label>
  </details>;
}
