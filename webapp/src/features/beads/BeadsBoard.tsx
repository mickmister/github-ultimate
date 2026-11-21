import { useBeadsBoardFeature, type BeadsBoardProps } from './BeadsBoard.hooks';
import { BeadsBoardPresentation } from './BeadsBoard.presentation';
export function BeadsBoard(props: BeadsBoardProps) {
  const board = useBeadsBoardFeature(props);
  return <BeadsBoardPresentation {...board} />;
}
