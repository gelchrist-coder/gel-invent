import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          // Point local dev at the deployed backend so /api/* works without a
          // local server. Override with VITE_DEV_API_TARGET for true local dev.
          target: env.VITE_DEV_API_TARGET || 'https://gel-invent.vercel.app',
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    define: {
      "import.meta.env.Site_key": JSON.stringify(env.Site_key || ""),
    },
  };
});
