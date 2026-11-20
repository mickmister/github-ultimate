import type { SurfaceProps } from '../../presentation/Presentation';
import type { HomeModel } from './Home.model';
import { HomeHeader, HomeRequests, HomeSources } from './Home.parts.view';
import { homeCopy as copy } from './Home.copy';
export function HomePhoneView(props: SurfaceProps<HomeModel>) {
  return <main className="home home-phone" data-home-surface="phone" data-orientation={props.presentation.orientation}>
    <HomeHeader {...props} /><HomeRequests {...props} />
    <details className="home-source-disclosure" open={props.state.error || props.state.sources.some(source => source.error) ? true : undefined}><summary>{copy.sources.text}</summary><HomeSources {...props} /></details>
  </main>;
}
