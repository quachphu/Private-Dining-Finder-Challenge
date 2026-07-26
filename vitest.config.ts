import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The logic worth unit-testing here (trust derivation, ranking, price
    // signalling) is pure and server-side, so plain node is enough — no
    // jsdom/browser environment needed.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
