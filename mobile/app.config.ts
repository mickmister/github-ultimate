import type { ExpoConfig } from 'expo/config';
import { execFileSync } from 'node:child_process';

// Resolve the source while producing the bundle/update, never from the hosted
// deployment. EAS workers may receive an archive without its .git directory.
let buildCommit: string;
try {
  buildCommit = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch {
  buildCommit = process.env.EAS_BUILD_GIT_COMMIT_HASH ?? '';
}
if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(buildCommit)) buildCommit = 'unavailable';

const projectId = process.env.EXPO_PROJECT_ID || 'c198f19d-590b-4362-85f8-9e48c34db45a';
const config: ExpoConfig = {
  name: 'Alohak', slug: 'alohak', version: '0.1.0',
  scheme: 'alohak',
  platforms: ['ios', 'android'],
  ios: { bundleIdentifier: 'dev.alohak.mobile', supportsTablet: true },
  android: { package: 'dev.alohak.mobile', permissions: ['INTERNET'] },
  plugins: ['expo-secure-store'],
  owner: process.env.EXPO_OWNER,
  extra: { buildCommit, entryURL: process.env.EXPO_PUBLIC_ALOHAK_URL ?? '', ...(projectId ? { eas: { projectId } } : {}) },
  // Manual EAS releases may update the bundled RN shell/policy. Native APIs
  // remain compiled into the binary; fingerprints prevent incompatible updates.
  runtimeVersion: { policy: 'fingerprint' },
  updates: projectId ? { url: `https://u.expo.dev/${projectId}` } : { enabled: false },
};
export default config;
