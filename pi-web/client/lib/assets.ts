/** Static assets are scoped to the deployed frontend, independently of storage. */
export function assetPath(path: string): string {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}${path.startsWith('/') ? path : `/${path}`}`;
}
