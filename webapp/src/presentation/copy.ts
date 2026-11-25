type Purpose = 'action' | 'label' | 'heading' | 'status' | 'error' | 'permission';
export function defineCopy<T extends Record<string, { purpose: Purpose; text: string }>>(entries: T): { [K in keyof T]: string } {
  return Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, entry.text])) as { [K in keyof T]: string };
}
