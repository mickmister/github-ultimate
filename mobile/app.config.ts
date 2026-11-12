import type { ExpoConfig } from 'expo/config';

const projectId = process.env.EXPO_PROJECT_ID || 'c198f19d-590b-4362-85f8-9e48c34db45a';
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
