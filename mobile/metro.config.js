// The app shares pure TypeScript with the desktop (../app/lib, ../app/types, ../app/services/syncProtocol.ts).
// Metro watches that folder, and packages imported by shared files resolve from mobile/node_modules,
// never from the desktop's node_modules (different React, Electron deps).
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [path.join(repoRoot, 'app')];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const shared = !context.originModulePath.startsWith(projectRoot + path.sep);
  const bare = !moduleName.startsWith('.') && !path.isAbsolute(moduleName);
  const ctx = shared && bare ? { ...context, originModulePath: path.join(projectRoot, 'package.json') } : context;
  return context.resolveRequest(ctx, moduleName, platform);
};

module.exports = config;
