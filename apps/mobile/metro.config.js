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
  "@cagnotte/contracts": path.resolve(workspaceRoot, "packages/contracts/src/index.ts"),
  "@cagnotte/handlers": path.resolve(workspaceRoot, "packages/handlers/src/index.ts"),
  "@cagnotte/postgres": path.resolve(workspaceRoot, "packages/postgres/src/index.ts"),
};
// Demo mode imports the database package file by file (`@cagnotte/postgres/adapters`), so the
// files that need node-postgres or the filesystem stay out of the web bundle.
const postgresSources = path.resolve(workspaceRoot, "packages/postgres/src");

// PGlite's loader reaches for Node's modules in branches the browser never runs; in the browser
// bundle they resolve to nothing instead of failing the build. The static render of the routes
// runs in Node and keeps them.
const NODE_BUILTINS = new Set(["fs", "fs/promises", "path", "util", "zlib", "stream", "stream/promises", "module", "url", "crypto", "os"]);

const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Workspace packages resolve to their TypeScript source, not to a build output.
  const source = packageSources[moduleName];
  if (source) return { type: "sourceFile", filePath: source };
  if (moduleName.startsWith("@cagnotte/postgres/")) return { type: "sourceFile", filePath: path.join(postgresSources, `${moduleName.slice("@cagnotte/postgres/".length)}.ts`) };
  if (platform === "web" && context.customResolverOptions?.environment !== "node") {
    const bare = moduleName.startsWith("node:") ? moduleName.slice(5) : moduleName;
    if (NODE_BUILTINS.has(bare)) return { type: "empty" };
  }
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
