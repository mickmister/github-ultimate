type Observer = <T>(name: string, operation: () => Promise<T>) => Promise<T>;
let observer: Observer | undefined;
// Legacy hosted pages need only this opt-in hook, not the diagnostics/export UI.
export function observeOperations(value: Observer) { observer = value; }
export function measureOperation<T>(name: string, operation: () => Promise<T>): Promise<T> {
  return observer ? observer(name, operation) : operation();
}
