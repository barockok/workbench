import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 3001,
    proxy: {
      "/api": "http://localhost:3000",
      "/callback": "http://localhost:3000",
    },
  },
});
