import type { SurfaceProps } from '../../presentation/Presentation';
import type { HomeModel } from './Home.model';
import { HomeHeader, HomeRequests, HomeSources } from './Home.parts.view';
export function HomeTabletView(props: SurfaceProps<HomeModel>) {
  return <main className="home home-tablet" data-home-surface="tablet" data-orientation={props.presentation.orientation}>
    <HomeHeader {...props} /><div className="home-tablet-workspace"><HomeRequests {...props} /><aside><HomeSources {...props} /></aside></div>
  </main>;
}
