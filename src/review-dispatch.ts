// Privileged host configuration, never accepted from a hosted page or review content.
// Forks may supply this constructor setting from their trusted extension bootstrap.
export interface ReviewDispatchHost {
  repository: string;
  workflow: string;
  ref: string;
  sourceConnectionId?: string;
}
export const pilotReviewDispatch: ReviewDispatchHost = {
  repository: 'mickmister/gh-agentic-workflows',
  workflow: 'qrspi-process.yml',
  ref: 'vk/46e5-vd-multi-instanc',
};
