/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_RECAPTCHA_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  grecaptcha?: {
    ready: (callback: () => void) => void;
    render: (
      container: HTMLElement | string,
      parameters: {
        sitekey: string;
        callback?: (token: string) => void;
        "expired-callback"?: () => void;
        "error-callback"?: () => void;
      },
    ) => number;
    reset: (widgetId?: number) => void;
  };
  __gelInventRecaptchaScriptPromise?: Promise<void>;
}
