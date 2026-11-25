const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
// Portable protocol lives beside the extension source, outside the app root.
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '..')];
config.maxWorkers = 2;
module.exports = config;
