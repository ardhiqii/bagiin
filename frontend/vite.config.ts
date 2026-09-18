import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(__dirname, "src"),
  publicDir: false,
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8082",
      "/uploads": "http://127.0.0.1:8082",
      "/static": "http://127.0.0.1:8082"
    }
  },
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          // Only react is pinned into its own chunk. Phosphor icons are NOT:
          // forcing them into a single `icons` chunk made Vite modulepreload the
          // whole icon set on first paint, so a guest opening a shared bill link
          // downloaded every icon the app owns even though BillRoute needs a
          // handful. Letting Rollup place them per-route keeps the entry graph
          // smaller (measured -3.8 KB home, -6.6 KB bill) and still dedupes
          // shared icons into a common chunk automatically.
          react: ["react", "react-dom"],
        },
      },
    },
  },
});
