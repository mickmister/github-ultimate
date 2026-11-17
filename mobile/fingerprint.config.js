// Native dependency patches live above the Expo app in this pnpm workspace.
// Include their bytes explicitly, even if node_modules are ignored by hashing.
module.exports = {
  extraSources: [{ type: 'file', filePath: '../patches/react-native-webview@13.15.0.patch', reasons: ['alohakNativeBridge'] }],
  // Bundle provenance and the JS-only GitHub switch do not change native APIs.
  // Canonicalize that switch to the original false baseline, retaining native
  // compatibility while the actual OTA manifest still carries its selected value.
  // Preserve every other config value and all native dependency/patch bytes.
  fileHookTransform(source, chunk) {
    if (source.type !== 'contents' || source.id !== 'expoConfig' || chunk === null) return chunk;
    const config = JSON.parse(chunk.toString());
    if (!config.extra) return chunk;
    delete config.extra.buildCommit;
    if (config.extra.githubConnectionsEnabled === true) config.extra.githubConnectionsEnabled = false;
    return JSON.stringify(config);
  },
};
