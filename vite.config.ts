import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Both API calls and preview media must reach the native processing service.
const backend = "http://127.0.0.1:4173";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: backend, changeOrigin: true },
      "/media": { target: backend, changeOrigin: true },
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
