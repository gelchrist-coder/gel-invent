/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_RECAPTCHA_SITE_KEY?: string;
  // Injected by vite.config from the SITE_KEY env var (reCAPTCHA v3 site key).
  readonly RECAPTCHA_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  grecaptcha?: {
    ready: (callback: () => void) => void;
    // reCAPTCHA v3: invisible, returns a token for the given action.
    execute: (siteKey: string, options: { action: string }) => Promise<string>;
  };
  __gelInventRecaptchaScriptPromise?: Promise<void>;
}
