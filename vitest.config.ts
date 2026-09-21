import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Mirror the "@/*" path alias from tsconfig.json so tests can import app code.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
