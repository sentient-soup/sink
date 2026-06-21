import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Web UI lives in src/client; the API server runs separately on :6720.
export default defineConfig({
  root: "src/client",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Anchor to /api/ so it doesn't swallow client modules like /api.ts.
      "^/api/": { target: "http://localhost:6720", changeOrigin: true },
    },
    // Allow importing src/shared, which lives above the client root.
    fs: { allow: [".."] },
  },
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
});
