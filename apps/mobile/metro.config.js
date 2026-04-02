const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

const config = getDefaultConfig(__dirname);

// Find jose browser build directory
// In monorepo with bun, jose is in root node_modules/.bun/
function findJoseBrowserDir() {
  // Check root monorepo node_modules/.bun/ first
  const rootDir = path.resolve(__dirname, '..', '..');
  const bunDir = path.join(rootDir, 'node_modules', '.bun');
  
  if (fs.existsSync(bunDir)) {
    const entries = fs.readdirSync(bunDir);
    for (const entry of entries) {
      if (entry.startsWith('jose@')) {
        const browserDir = path.join(bunDir, entry, 'node_modules', 'jose', 'dist', 'browser');
        if (fs.existsSync(path.join(browserDir, 'index.js'))) {
          return browserDir;
        }
      }
    }
  }
  
  // Fallback: check local node_modules
  const localJose = path.join(__dirname, 'node_modules', 'jose', 'dist', 'browser');
  if (fs.existsSync(path.join(localJose, 'index.js'))) {
    return localJose;
  }
  
  return null;
}

const JOSE_BROWSER_DIR = findJoseBrowserDir();

if (JOSE_BROWSER_DIR) {
  // Custom resolver that redirects ALL jose Node.js imports to browser build
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    // Match: "jose", "jose/*", or any absolute path containing "/jose/dist/node/"
    const isJoseImport = 
      moduleName === 'jose' ||
      moduleName.startsWith('jose/') ||
      (moduleName.includes('/jose/') && moduleName.includes('/dist/node/'));
    
    if (isJoseImport) {
      let browserFilePath;
      
      if (moduleName === 'jose') {
        // Main import -> browser/index.js
        browserFilePath = path.join(JOSE_BROWSER_DIR, 'index.js');
      } else if (moduleName.includes('/dist/node/')) {
        // Absolute path to Node.js build -> redirect to browser
        browserFilePath = moduleName
          .replace(/\/dist\/node\/(esm|cjs)\//, '/dist/browser/')
          .replace(/\.mjs$/, '.js');
      } else {
        // Subpath like "jose/jwt/verify" -> browser/jwt/verify.js
        const subpath = moduleName.replace('jose/', '');
        browserFilePath = path.join(JOSE_BROWSER_DIR, subpath);
        if (!browserFilePath.endsWith('.js')) {
          browserFilePath += '.js';
        }
      }
      
      if (fs.existsSync(browserFilePath)) {
        return { type: 'sourceFile', filePath: browserFilePath };
      }
    }
    
    // Default resolver
    return context.resolveRequest(context, moduleName, platform);
  };
}

module.exports = config;
