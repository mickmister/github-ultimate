// Shared with page readers without importing privileged request-schema dependencies.
export const maxDoltBlobBytes = 64 * 1024 * 1024;
export const gitBlobPartBytes = 3 * 1024 * 1024;
export const nativeReadConcurrency = 6;
// Admit six ordinary 24 MiB responses; large-part calls reserve 96 MiB each.
export const nativeReadResponseBytes = nativeReadConcurrency * 24 * 1024 * 1024;
