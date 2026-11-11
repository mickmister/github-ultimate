import type { DocumentDTO } from '../../app-hooks/contracts';
import type { FeedbackTarget } from '../feedback/contracts';
import type { DocumentBrowserModel } from './contracts';

export function documentFeedbackTarget(model: DocumentBrowserModel, document: DocumentDTO, featureId: string, representation?: string): FeedbackTarget {
  return {
    elementId: `${featureId}:${document.id}`, label: document.path, uiPath: ['Documents', 'Reader'], featureId, representation,
    resource: { kind: 'document', id: document.id, path: document.path, repository: model.repository, workspace: model.workspaceId, revision: model.snapshot?.commit },
  };
}
