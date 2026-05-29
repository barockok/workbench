import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        // /api/auth/cookie/<int>/cdp is a WebSocket — enable WS proxying.
        ws: true,
      },
      "/callback": "http://localhost:3001",
    },
  },
});
