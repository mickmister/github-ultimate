// Native dependency patches live above the Expo app in this pnpm workspace.
// Include their bytes explicitly, even if node_modules are ignored by hashing.
module.exports = {
  extraSources: [{ type: 'file', filePath: '../patches/react-native-webview@13.15.0.patch', reasons: ['alohakNativeBridge'] }],
  // Bundle provenance does not change native APIs. Preserve native config and
  // dependency/patch bytes; GitHub connections have no release-time switch.
  fileHookTransform(source, chunk) {
    if (source.type !== 'contents' || source.id !== 'expoConfig' || chunk === null) return chunk;
    const config = JSON.parse(chunk.toString());
    if (!config.extra) return chunk;
    delete config.extra.buildCommit;
    return JSON.stringify(config);
  },
};
