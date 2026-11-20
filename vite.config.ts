import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(root, "web"),
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@engine": path.join(root, "src/engine/index.ts"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 4179,
    strictPort: true,
  },
  build: {
    outDir: path.join(root, "dist-web"),
    emptyOutDir: true,
  },
});
