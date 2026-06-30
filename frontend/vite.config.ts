import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // reCAPTCHA v3 site key. Vercel injects dashboard vars into process.env at
  // build, so we read SITE_KEY directly (a non-VITE_ name isn't auto-exposed to
  // the browser). Falls back to VITE_RECAPTCHA_SITE_KEY or a local .env value.
  const recaptchaSiteKey =
    process.env.SITE_KEY ||
    process.env.VITE_RECAPTCHA_SITE_KEY ||
    env.SITE_KEY ||
    env.VITE_RECAPTCHA_SITE_KEY ||
    "";

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
      "import.meta.env.RECAPTCHA_SITE_KEY": JSON.stringify(recaptchaSiteKey),
    },
  };
});
