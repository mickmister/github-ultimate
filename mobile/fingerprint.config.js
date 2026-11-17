// Native dependency patches live above the Expo app in this pnpm workspace.
// Include their bytes explicitly, even if node_modules are ignored by hashing.
let easChunks = [];
module.exports = {
  extraSources: [{ type: 'file', filePath: '../patches/react-native-webview@13.15.0.patch', reasons: ['alohakNativeBridge'] }],
  // Bundle provenance and the JS-only GitHub switch do not change native APIs.
  // Canonicalize that switch to the original false baseline, retaining native
  // compatibility while the actual OTA manifest still carries its selected value.
  // Preserve every other config value and all native dependency/patch bytes.
  fileHookTransform(source, chunk, isEndOfFile) {
    // EAS writes the same JS switch into its uploaded build profile. Buffer this
    // small JSON file across stream chunks, preserving every other profile value.
    if (source.type === 'file' && source.filePath === 'eas.json') {
      if (chunk !== null) easChunks.push(Buffer.from(chunk));
      if (!isEndOfFile) return null;
      const text = Buffer.concat(easChunks).toString('utf8'); easChunks = [];
      const profiles = JSON.parse(text);
      let changed = false;
      for (const profile of Object.values(profiles.build ?? {})) {
        if (profile.env?.EXPO_PUBLIC_ALOHAK_GITHUB_CONNECTIONS === '1') {
          profile.env.EXPO_PUBLIC_ALOHAK_GITHUB_CONNECTIONS = '0'; changed = true;
        }
      }
      return changed ? JSON.stringify(profiles, null, 2) + '\n' : text;
    }
    if (source.type !== 'contents' || source.id !== 'expoConfig' || chunk === null) return chunk;
    const config = JSON.parse(chunk.toString());
    if (!config.extra) return chunk;
    delete config.extra.buildCommit;
    if (config.extra.githubConnectionsEnabled === true) config.extra.githubConnectionsEnabled = false;
    return JSON.stringify(config);
  },
};
