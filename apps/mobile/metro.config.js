const { getDefaultConfig } = require("expo/metro-config");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// The app imports the workspace packages from their source, so Metro watches the whole repo and
// resolves from both node_modules folders.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules"), path.resolve(workspaceRoot, "node_modules")];

const packageSources = {
  "@cagnotte/domain": path.resolve(workspaceRoot, "packages/domain/src/index.ts"),
};

const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Workspace packages resolve to their TypeScript source, not to a build output.
  const source = packageSources[moduleName];
  if (source) return { type: "sourceFile", filePath: source };
  // The packages import each other with ".js" endings, as Node's ESM resolution wants; Metro
  // resolves them to the ".ts" file next to the importer when the ".js" one does not exist.
  if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    const base = path.resolve(path.dirname(context.originModulePath), moduleName.slice(0, -3));
    for (const ext of [".ts", ".tsx"]) {
      if (fs.existsSync(base + ext)) return { type: "sourceFile", filePath: base + ext };
    }
  }
  return (defaultResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
