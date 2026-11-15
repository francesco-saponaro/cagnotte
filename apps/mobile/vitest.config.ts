import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/*
 * The app's tests render the screens with react-native-web in jsdom, the same way the web export
 * renders them in the browser, and talk to a fake transport instead of the API.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: "react-native-web" },
      { find: "@cagnotte/domain", replacement: src("../../packages/domain/src/index.ts") },
      { find: "@cagnotte/contracts", replacement: src("../../packages/contracts/src/index.ts") },
      { find: /^@\/(.*)$/, replacement: `${src("./src/")}$1` },
    ],
  },
  test: {
    name: "mobile",
    environment: "jsdom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    setupFiles: ["test/setup.ts"],
  },
});
