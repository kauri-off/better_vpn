import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// `base: "./"` makes all asset URLs relative so the panel works under any
// Caddy subpath (e.g. /panel) without rebuilding.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // During local dev, proxy gRPC-Web calls to the backend.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:50051",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
