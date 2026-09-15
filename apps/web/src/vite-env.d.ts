/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL of the server API. Used by `lib/api/client.ts`. Leave unset
   * to default to http://localhost:3000 for dev. Set to "" for same-origin
   * deployments, or to a full origin (e.g. https://api.arcadeai.app) for
   * split-origin production deployments.
   */
  readonly VITE_API_BASE?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
