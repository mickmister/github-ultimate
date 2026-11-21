import type { AppHooksV1 } from '../../app-hooks/contracts';
import { useHomeFeature } from './Home.hooks';
import { HomePresentation } from './Home.presentation';
import './home.css';
export function Home({ appHooks }: { appHooks?: AppHooksV1 }) {
  const model = useHomeFeature(appHooks);
  return <HomePresentation {...model} />;
}
