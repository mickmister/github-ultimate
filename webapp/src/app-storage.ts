import { openPageStorage } from '../../hosted/page-storage';

// Application code sees one API. Platform detection and transports live in the
// shared SDK; native hosts can inject the adapter without shipping it in the UI.
let opened: ReturnType<typeof openPageStorage> | undefined;
export async function applicationStorage() {
  opened ??= openPageStorage().then(async handle => {
    try {
      const storage = handle.storage, migrated = 'github-ultimate:storage-migration:v1';
      if (storage.getItem(migrated) === null) {
        // Preserve existing application preferences, without importing arbitrary
        // origin data or reintroducing deleted preferences on every cold launch.
        const values: [string, string][] = [];
        try {
          const legacy = window.localStorage;
          for (let index = 0; index < legacy.length; index++) {
            const key = legacy.key(index);
            if (key?.startsWith('github-ultimate')) values.push([key, legacy.getItem(key)!]);
          }
        } catch { /* Native storage also works when browser localStorage is blocked. */ }
        for (const [key, value] of values) if (storage.getItem(key) === null) storage.setItem(key, value);
        storage.setItem(migrated, '1'); await storage.flush();
      }
      return handle;
    } catch (error) { handle.close(); throw error; }
  }).catch(error => { opened = undefined; throw error; });
  return (await opened).storage;
}
