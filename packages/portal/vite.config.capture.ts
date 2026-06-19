import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Throwaway config for screenshot capture: portal on 4000, proxy to the
// isolated capture server on 4001 (the default 3001 is squatted by another app).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4000,
    strictPort: true,
    proxy: {
      "/api": { target: "http://localhost:4001", ws: true },
      "/callback": "http://localhost:4001",
    },
  },
});
