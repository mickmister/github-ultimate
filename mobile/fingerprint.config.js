// Native dependency patches live above the Expo app in this pnpm workspace.
// Include their bytes explicitly, even if node_modules are ignored by hashing.
module.exports = {
  extraSources: [{ type: 'file', filePath: '../patches/react-native-webview@13.15.0.patch', reasons: ['alohakNativeBridge'] }],
  // Display-only bundle provenance must not make every JS commit require a new
  // binary. Preserve every other config value and all native dependency/patch bytes.
  fileHookTransform(source, chunk) {
    if (source.type !== 'contents' || source.id !== 'expoConfig' || chunk === null) return chunk;
    const config = JSON.parse(chunk.toString());
    if (!config.extra || !Object.hasOwn(config.extra, 'buildCommit')) return chunk;
    delete config.extra.buildCommit;
    return JSON.stringify(config);
  },
};
