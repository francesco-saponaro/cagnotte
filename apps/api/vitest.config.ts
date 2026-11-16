import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: "@cagnotte/domain", replacement: src("../../packages/domain/src/index.ts") },
      { find: "@cagnotte/contracts", replacement: src("../../packages/contracts/src/index.ts") },
      { find: "@cagnotte/handlers", replacement: src("../../packages/handlers/src/index.ts") },
      { find: /^@cagnotte\/postgres\/(.*)$/, replacement: `${src("../../packages/postgres/src/")}$1` },
      { find: "@cagnotte/postgres", replacement: src("../../packages/postgres/src/index.ts") },
    ],
  },
  test: {
    name: "api",
    include: ["test/**/*.test.ts"],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
