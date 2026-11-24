'use client';
type Runtime = Window['piWebExtension'];
let loading: Promise<Runtime> | undefined;
export function runtime() {
  return loading ??= new Promise<Runtime>((resolve, reject) => {
    const script = document.createElement('script'); script.type = 'module';
    script.src = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/extension-runtime.js?build=${encodeURIComponent(process.env.NEXT_PUBLIC_APP_VERSION ?? 'development')}`;
    script.onload = () => {
      if (window.piWebExtension?.protocolVersion !== 2) { loading = undefined; script.remove(); reject(Error('Pi Web resources are from different builds. Reload the page to update.')); return; }
      resolve(window.piWebExtension);
    };
    script.onerror = () => { loading = undefined; script.remove(); reject(Error('Could not load Pi. Reload and retry.')); };
    document.head.append(script);
  });
}
