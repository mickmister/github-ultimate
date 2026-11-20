import type { SurfaceProps } from '../../presentation/Presentation';
import type { HomeModel } from './Home.model';
import { HomeHeader, HomeRequests, HomeSources } from './Home.parts.view';
export function HomeDesktopView(props: SurfaceProps<HomeModel>) {
  return <main className="home home-desktop" data-home-surface="desktop" data-orientation={props.presentation.orientation}>
    <HomeHeader {...props} /><div className="home-desktop-workspace"><aside><HomeSources {...props} /></aside><HomeRequests {...props} /></div>
  </main>;
}
