import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'GitHub Ultimate Companion', slug: 'github-ultimate-companion', version: '0.1.0',
  scheme: 'githubultimate',
  platforms: ['ios', 'android'],
  ios: { bundleIdentifier: 'dev.githubultimate.companion', supportsTablet: true },
  android: { package: 'dev.githubultimate.companion', permissions: ['INTERNET'] },
  extra: { entryURL: process.env.EXPO_PUBLIC_COMPANION_URL ?? '' },
  // Native broker updates must ship with the installed binary, not remote OTA.
  updates: { enabled: false },
};
export default config;
