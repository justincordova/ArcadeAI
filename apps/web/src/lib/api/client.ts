/**
 * Base URL for all server API requests. Defined once so changing the port
 * or host requires a single edit rather than updating every fetch call.
 *
 * Set `VITE_API_BASE` in `.env` (or in your hosting provider's build env)
 * to point at the deployed server origin. Defaults to localhost:3000 for
 * `bun run dev`. Set to "" (empty string) for same-origin deployments
 * where the SPA and API share a host — all fetches become relative.
 *
 * Vite inlines `import.meta.env.VITE_*` values at build time, so this
 * constant is baked into the bundle. Changing the API URL requires a
 * fresh build, not a runtime config.
 */
export const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";
