const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

// La app reutiliza código del repo (src/shared y src/client/dates.ts): Metro debe vigilar esa carpeta
// y resolver sus dependencias (zod) desde mobile/node_modules.
const config = getDefaultConfig(__dirname)
config.watchFolders = [path.resolve(__dirname, '../src')]
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')]

module.exports = config
