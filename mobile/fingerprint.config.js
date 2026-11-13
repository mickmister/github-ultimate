// Native dependency patches live above the Expo app in this pnpm workspace.
// Include their bytes explicitly, even if node_modules are ignored by hashing.
module.exports = {
  extraSources: [{ type: 'file', filePath: '../patches/react-native-webview@13.15.0.patch', reasons: ['alohakNativeBridge'] }],
};
