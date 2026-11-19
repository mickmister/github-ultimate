import { createContext, createElement, useContext, useEffect, useState, type ComponentType, type ReactNode, type ReactElement } from 'react';
import { classifyPresentation, nextGeometry, type Presentation } from './geometry';

const Context = createContext<Presentation | null>(null);
const initial: Presentation = { surface: 'phone', orientation: 'portrait' };
export function PresentationProvider({ children, value }: { children: ReactNode; value?: Presentation }) {
  const [presentation, setPresentation] = useState(initial);
  useEffect(() => {
    if (value) return;
    let geometry = { width: window.innerWidth, height: window.innerHeight };
    const update = () => {
      const editing = document.activeElement?.matches('input, textarea, [contenteditable="true"]') ?? false;
      geometry = nextGeometry(geometry, { width: window.innerWidth, height: window.innerHeight }, editing);
      const next = classifyPresentation(geometry.width, geometry.height);
      setPresentation(current => current.surface === next.surface && current.orientation === next.orientation ? current : next);
    };
    update(); window.addEventListener('resize', update); window.addEventListener('focusout', update);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('focusout', update); };
  }, [value]);
  return createElement(Context.Provider, { value: value ?? presentation }, children);
}

export type SurfaceProps<P> = P & { presentation: Presentation };
type Definition<P> = { id: string; phone: ComponentType<SurfaceProps<P>>; tablet: ComponentType<SurfaceProps<P>>; desktop: ComponentType<SurfaceProps<P>> };
function definePresentation<P extends object>(definition: Definition<P>) {
  function Resolved(props: P): ReactElement {
    const context = useContext(Context) ?? initial;
    return createElement(definition[context.surface], { ...props, presentation: context });
  }
  return function DevicePresentation(props: P): ReactElement {
    const context = useContext(Context);
    if (!context) return createElement(PresentationProvider, { children: createElement(Resolved, props) });
    return createElement(Resolved, props);
  };
}
export const defineDevicePage = definePresentation;
export const defineDeviceRegion = definePresentation;
