/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  /** Site key PÚBLICA de Cloudflare Turnstile (nunca la secret key). */
  readonly VITE_TURNSTILE_SITE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Versión desplegada (7 caracteres del commit, o 'local'): la define `vite.config.ts`. Leerla con `APP_VERSION` (src/lib/version.ts). */
declare const __APP_VERSION__: string;
