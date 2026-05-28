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
      "/api": "http://localhost:3001",
      "/callback": "http://localhost:3001",
    },
  },
});
