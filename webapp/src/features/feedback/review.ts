import type { FeedbackComment, FeedbackSelection } from './contracts';

function sourceLines(selection: FeedbackSelection | null): string {
  if (selection?.representation !== 'source' || !Array.isArray(selection.ranges) || !selection.ranges.length) return '';
  const lines = [];
  for (const range of selection.ranges) {
    if (!range || typeof range !== 'object') return '';
    const { startLineNumber: start, endLineNumber: end, startColumn, endColumn } = range;
    if (![start, end, startColumn, endColumn].every(value => Number.isSafeInteger(value) && value > 0) || end < start || end === start && endColumn <= startColumn) return '';
    // Monaco's selection end is exclusive: column 1 belongs to the next line.
    const last = end > start && endColumn === 1 ? end - 1 : end;
    lines.push(start === last ? `${start}` : `${start}–${last}`);
  }
  return ` — ${lines.length === 1 && !lines[0].includes('–') ? 'line' : 'lines'} ${lines.join(', ')}`;
}

/** Human-readable clipboard output; the full capture stays in the draft model. */
export function formatFeedbackReview(items: readonly FeedbackComment[]): string {
  const scopes = new Map<string, { repository?: string; workspace?: string; groups: Map<string, FeedbackComment[]> }>();
  for (const item of items) {
    const { target, pageUrl } = item.context;
    const resource = target.resource;
    const scopeKey = JSON.stringify([resource?.repository, resource?.workspace]);
    let scope = scopes.get(scopeKey);
    if (!scope) {
      scope = { repository: resource?.repository, workspace: resource?.workspace, groups: new Map() };
      scopes.set(scopeKey, scope);
    }
    const key = resource
      ? JSON.stringify([resource.kind, resource.path ?? resource.id, resource.revision, pageUrl])
      : JSON.stringify([target.elementId, target.featureId, pageUrl]);
    const group = scope.groups.get(key) ?? [];
    group.push(item);
    scope.groups.set(key, group);
  }

  const sections: string[] = [];
  for (const scope of scopes.values()) {
    const identity = [scope.repository && `Repository: ${scope.repository}`, scope.workspace && `Workspace: ${scope.workspace}`].filter(Boolean);
    if (identity.length) sections.push(identity.join('\n'));
    for (const group of scope.groups.values()) {
      const { target, pageUrl } = group[0].context;
      const resource = target.resource;
      const heading = resource?.path ?? (resource ? resource.id : target.label);
      const header = [`# ${heading}`, resource?.revision && `Revision: ${resource.revision}`, pageUrl && `Page: ${pageUrl}`].filter(Boolean).join('\n');
      const comments = group.map((item, index) => {
        const { target: commentTarget, selection } = item.context;
        const feature = item.kind === 'feature-comment' ? ` — Feature: ${commentTarget.featureId}` : '';
        const quote = selection ? `${selection.text.split('\n').map(line => `> ${line}`).join('\n')}\n\n` : '';
        return `## ${index + 1}${sourceLines(selection)}${feature}\n\n${quote}${item.comment}`;
      });
      sections.push([header, ...comments].join('\n\n'));
    }
  }
  return sections.join('\n\n') + '\n';
}
