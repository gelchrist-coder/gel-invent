import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash].js?v=${Date.now()}`,
        chunkFileNames: `assets/[name]-[hash].js?v=${Date.now()}`,
        assetFileNames: `assets/[name]-[hash].[ext]`
      }
    }
  }
});
