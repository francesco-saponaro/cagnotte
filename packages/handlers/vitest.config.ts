import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: "@cagnotte/domain", replacement: src("../domain/src/index.ts") },
      { find: "@cagnotte/contracts", replacement: src("../contracts/src/index.ts") },
    ],
  },
  test: {
    name: "handlers",
    include: ["test/**/*.test.ts"],
  },
});
