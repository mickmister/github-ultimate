import type { ExpoConfig } from 'expo/config';

const projectId = process.env.EXPO_PROJECT_ID;
if (projectId && !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(projectId)) throw new Error('EXPO_PROJECT_ID must be an Expo project UUID.');
const config: ExpoConfig = {
  name: 'Alohak', slug: 'alohak', version: '0.1.0',
  scheme: 'alohak',
  platforms: ['ios', 'android'],
  ios: { bundleIdentifier: 'dev.alohak.mobile', supportsTablet: true },
  android: { package: 'dev.alohak.mobile', permissions: ['INTERNET'] },
  owner: process.env.EXPO_OWNER,
  extra: { entryURL: process.env.EXPO_PUBLIC_ALOHAK_URL ?? '', ...(projectId ? { eas: { projectId } } : {}) },
  // Manual EAS releases may update the bundled RN shell/policy. Native APIs
  // remain compiled into the binary; fingerprints prevent incompatible updates.
  runtimeVersion: { policy: 'fingerprint' },
  updates: projectId ? { url: `https://u.expo.dev/${projectId}` } : { enabled: false },
};
export default config;
