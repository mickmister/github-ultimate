/** A transport-wide bound keeps foreground reads below the bridge's eight-request cap. */
export function limitConcurrency(limit = 4) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(operation: () => Promise<T>): Promise<T> {
    await new Promise<void>(resolve => {
      const start = () => { active++; resolve(); };
      if (active < limit) start(); else waiting.push(start);
    });
    try { return await operation(); }
    finally { active--; waiting.shift()?.(); }
  };
}
