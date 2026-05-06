# 01 — Monorepo Scaffold — Implementation Plan

Reference design: `docs/designs/01-monorepo-scaffold.md`. Reference spec: `docs/SPEC.md` §3, §4, §5, §11, §14, §15, §19 step 1.

## Pre-flight checks

### Required tools

- `bun --version` ≥ 1.1 (Bun is the runtime per SPEC §3).
- `git` available; repo is already initialized at `/Users/justincordova/cs/projects/ArcadeAI`.
- `sqlite3` CLI (optional, for verifying `rag_embeddings` table existence).

### Repo state assumption

- The repo currently contains only `docs/` (`SPEC.md`, `designs/`, `plans/`). All other paths from SPEC §4 do not exist yet. If any do, stop and reconcile before proceeding — this plan assumes a clean scaffold.

### Open question to resolve before starting (from design doc §Open questions)

- **Q1 — `vec0` at step 1 vs. step 9.** This plan assumes **reading (a)**: install `sqlite-vec` now, load it in `client.ts`, run the `CREATE VIRTUAL TABLE` post-migrate. If reviewer prefers reading (b), tasks 6.4–6.6 below become a no-op stub and the `sqlite-vec` dependency is deferred.

## Task list

Each task is independently verifiable. Run from repo root unless otherwise noted.

### 1. Root scaffolding

1.1. Create `package.json` at repo root with:
   - `"name": "arcadeai"`, `"private": true`, `"type": "module"`
   - `"workspaces": ["apps/*", "packages/*"]`
   - Scripts: `dev` (`bun run --filter '*' dev`), `build` (`bun run --filter '*' build`), `lint` (`biome check .`), `format` (`biome format --write .`), `check` (`biome check --write .`)
   - `devDependencies`: `@biomejs/biome`, `typescript`
   
1.2. Create `tsconfig.base.json`: strict mode, `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `paths` for `@arcadeai/db` → `packages/db/src`, `@arcadeai/shared` → `packages/shared/src`.

1.3. Create `biome.json`: enable `linter` and `formatter`, organize imports, default rules. Single config covers all workspaces (SPEC §4).

1.4. Create `LICENSE` (MIT, copyright Justin Cordova, current year).

1.5. Create `.gitignore` matching SPEC §4 verbatim:
```
node_modules/
dist/
.env
.env.*.local
apps/server/data/
*.db
*.db-journal
*.db-wal
*.db-shm
.DS_Store
*.log
.tanstack/
```

1.6. Create `.env.example` matching SPEC §15 verbatim (all keys, placeholder values).

1.7. Create `README.md` documenting: prerequisites (Bun ≥ 1.1), `bun install`, copy `.env.example` → `.env`, `bun run dev`, ports (`:5173` web, `:3000` server), `/api/health` smoke test command.

**Verify:** `ls` shows the seven root files. `cat .env.example` matches SPEC §15.

### 2. Shared package

2.1. Create `packages/shared/package.json`: `"name": "@arcadeai/shared"`, `"type": "module"`, `"main": "./src/index.ts"`, `"exports": { ".": "./src/index.ts" }`.

2.2. Create `packages/shared/tsconfig.json` extending `../../tsconfig.base.json`.

2.3. Create stub files: `packages/shared/src/index.ts` (re-exports), `plans.ts`, `models.ts`, `types.ts` (each `export {}`).

**Verify:** `bun install` at root creates the workspace symlink.

### 3. DB package

3.1. Create `packages/db/package.json`: `"name": "@arcadeai/db"`, `"type": "module"`, `"main": "./src/index.ts"`, dependencies: `drizzle-orm`, `better-sqlite3`, `sqlite-vec` *(subject to Q1)*. devDependencies: `drizzle-kit`, `@types/better-sqlite3`. Scripts: `migrate` (`bun run src/migrate.ts`), `generate` (`drizzle-kit generate`).

3.2. Create `packages/db/tsconfig.json` extending base.

3.3. Create `packages/db/drizzle.config.ts` pointing `schema` at `src/schema.ts`, `out` at `src/migrations`, dialect `sqlite`, `dbCredentials.url` from `process.env.DATABASE_PATH`.

3.4. Create `packages/db/src/schema.ts` with Drizzle table stubs for the tables in SPEC §5 (`users`, `games`, `messages`, `usage_log`, `rag_examples`). No code references these yet — they exist so step 3 can extend rather than restructure. **Do not** define `rag_embeddings` here (it's a vec0 virtual table — handled in post-migrate).

   Note: Better Auth's `user`/`session`/`account` tables are managed by Better Auth's generated migrations in step 2. For step 1, just author our own table stubs. If this causes a Drizzle-managed `users` table to conflict with Better Auth's later `user` table, resolve in step 2 by aligning to Better Auth's schema (per SPEC §5: "users table extends Better Auth's built-in user table").

3.5. Create `packages/db/src/client.ts`: exports a `createClient(path: string)` returning a `drizzle()` instance over `better-sqlite3`. *(If Q1 = reading (a):)* call `db.loadExtension(...)` for `sqlite-vec` immediately after opening the connection.

3.6. Create `packages/db/src/post-migrate.ts`: opens the same client and runs `CREATE VIRTUAL TABLE IF NOT EXISTS rag_embeddings USING vec0(id text primary key, embedding float[1536])` (SPEC §5). *(If Q1 = reading (b):)* leave as a no-op TODO logging "deferred to step 9".

3.7. Create `packages/db/src/migrate.ts`: imports `migrate` from `drizzle-orm/better-sqlite3/migrator`, runs Drizzle migrations against `process.env.DATABASE_PATH`, then invokes `post-migrate.ts`.

3.8. Generate the initial Drizzle migration: `bun --cwd packages/db run generate`. Commit the SQL output in `src/migrations/`.

**Verify:** `mkdir -p apps/server/data && DATABASE_PATH=./apps/server/data/arcadeai.db bun --cwd packages/db run migrate` exits 0. `sqlite3 apps/server/data/arcadeai.db ".schema rag_embeddings"` shows the virtual table *(if Q1 = reading (a))*.

### 4. Server app

4.1. Create `apps/server/package.json`: dependencies `fastify`, `@fastify/cors`, `pino`, `pino-pretty`, `@arcadeai/db: workspace:*`, `@arcadeai/shared: workspace:*`. Scripts: `dev` (`bun run --watch src/index.ts`), `build` (`tsc --noEmit`).

4.2. Create `apps/server/tsconfig.json` extending base, with `references` to `../../packages/db` and `../../packages/shared`.

4.3. Create `apps/server/src/plugins/cors.ts`: a Fastify plugin registering `@fastify/cors` with `origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173'`, `credentials: true` (SPEC §14).

4.4. Create `apps/server/src/routes/health.ts`: registers `GET /api/health` returning `{ ok: true, version: pkg.version }` where `pkg` is imported from `../../package.json`. No auth.

4.5. Create `apps/server/src/index.ts`: bootstraps Fastify with Pino (`transport: { target: 'pino-pretty' }` when `NODE_ENV !== 'production'`, otherwise plain JSON — SPEC §14), registers CORS plugin, registers health route, listens on `process.env.PORT ?? 3000`.

4.6. Create `apps/server/data/.gitkeep` so the dir exists (file itself is gitignored via `apps/server/data/`; use `!.gitkeep` exception, or just don't commit and create at runtime). Decision: rely on the migrate task to create it at runtime; no `.gitkeep` needed.

**Verify:** `bun --cwd apps/server run dev` starts, logs port 3000, `curl -s http://localhost:3000/api/health` returns the expected JSON. `bun --cwd apps/server run build` exits 0.

### 5. Web app

5.1. Create `apps/web/package.json`: dependencies `react`, `react-dom`, `@tanstack/react-router`, `@tanstack/react-query`, `@arcadeai/shared: workspace:*`. devDependencies: `vite`, `@vitejs/plugin-react`, `@tanstack/router-vite-plugin`, `vite-tsconfig-paths`, `@tailwindcss/vite`, `tailwindcss`, `typescript`, `@types/react`, `@types/react-dom`. Scripts: `dev` (`vite`), `build` (`tsc --noEmit && vite build`).

5.2. Create `apps/web/tsconfig.json` extending base, with `jsx: react-jsx`, `references` to `../../packages/shared`.

5.3. Create `apps/web/vite.config.ts`: plugins `react()`, `tanstackRouterVite()`, `tsconfigPaths()`, `tailwindcss()`. `server.port: 5173`.

5.4. Create `apps/web/index.html` with a `<div id="root">` and a script tag pointing at `/src/main.tsx`.

5.5. Create `apps/web/src/styles/index.css` with `@import "tailwindcss";` (Tailwind v4 syntax).

5.6. Create `apps/web/src/main.tsx`: bootstraps React, instantiates a `QueryClient`, sets up TanStack Router with the generated route tree.

5.7. Create `apps/web/src/routes/__root.tsx`: minimal root layout with `<Outlet />`.

5.8. Create `apps/web/src/routes/index.tsx`: a component that on mount uses TanStack Query to `fetch('http://localhost:3000/api/health', { credentials: 'include' })` and renders the JSON response (or an error state). This is the smoke test target.

5.9. Add `apps/web/src/routeTree.gen.ts` to `.gitignore` if not already covered (it is — `.tanstack/` plus the plugin's default output; double-check the plugin's emit path).

**Verify:** `bun --cwd apps/web run dev` starts on `:5173`. Browser at `http://localhost:5173` shows `{ ok: true, version: ... }` rendered. No CORS errors. `bun --cwd apps/web run build` exits 0.

### 6. End-to-end smoke test (SPEC §19 step 1 acceptance)

6.1. From repo root: `bun install`. Confirms workspace linking.

6.2. From repo root: `bun run dev`. Confirms parallel boot. *(If `--filter` watch is broken, fall back to `concurrently` per SPEC §4.)*

6.3. In a browser: open `http://localhost:5173`. Confirm the page renders the health JSON. Open devtools → Network → confirm the request to `localhost:3000/api/health` succeeded with `Access-Control-Allow-Origin: http://localhost:5173` and `Access-Control-Allow-Credentials: true` response headers.

6.4. From repo root: `bun run lint`. Expect zero errors.

6.5. From repo root: `bun run build`. Expect zero errors.

6.6. From repo root: `bun run check`. Expect zero changes on a freshly written tree.

### 7. Final commit prep

Per AGENTS.md, the agent does not author commit messages. Tasks above produce the working tree; the developer commits.

## Verification checklist (mirrors design doc Acceptance criteria)

- [ ] `bun install` succeeds at root.
- [ ] `bun run dev` boots web on `:5173` and server on `:3000` in one command.
- [ ] `curl http://localhost:3000/api/health` returns `{"ok":true,"version":"..."}`.
- [ ] Web app at `http://localhost:5173` cross-origin-fetches `/api/health` with no CORS errors.
- [ ] `bun run lint`, `bun run build`, `bun run check` all pass.
- [ ] `packages/db` migrate runs cleanly; `rag_embeddings` virtual table exists *(per Q1 resolution)*.
- [ ] `LICENSE` (MIT), `README.md`, `.env.example` (verbatim from SPEC §15), `.gitignore` (verbatim from SPEC §4) all committed.
- [ ] No Better Auth, no LLM SDK, no game/message/auth routes in the tree.

## Commit Checkpoints

Commits use the project convention `type(scope): description` (lowercase, ≤72 chars, no trailing period). Per AGENTS.md, before each commit run the **pre-commit gate** in order:
1. Build (`bun run build` or workspace-scoped equivalent)
2. Tests (`bun test` if any tests exist for the touched workspace)
3. Lint/format (`bun run check`)

If anything fails, fix it and re-run the gate before committing.

### Checkpoint 1 — End of plan

After all tasks complete and the pre-commit gate passes:

```
chore(repo): initial monorepo scaffold with health endpoint
```

Includes: root workspace config, `apps/web`, `apps/server`, `packages/db`, `packages/shared`, `.env.example`, `.gitignore`, `LICENSE`, `README.md`, initial Drizzle migration, and the `/api/health` route.

## Rollback / cleanup notes

- If a task fails mid-way, the repo is salvageable by `git status` + `git restore .` + `rm -rf node_modules apps packages` (we only added under those paths plus root config files).
- If `bun install` corrupts `bun.lockb`, delete `bun.lockb` and `node_modules/` and re-run.
- If `drizzle-kit generate` produces an unexpected migration, delete `packages/db/src/migrations/` and regenerate — there's no committed migration to preserve in step 1.
- If the SQLite db file is created in a wrong location, delete `apps/server/data/arcadeai.db` and re-run `bun --cwd packages/db run migrate` with `DATABASE_PATH` set correctly. Per SPEC §4, `apps/server/data/` is gitignored so accidental files don't pollute commits.
- If `sqlite-vec` native binary fails to install (Q1 reading (a)), the fallback is to switch to reading (b): stub `post-migrate.ts` and defer the virtual table to step 9. This is a one-line change and does not block the rest of step 1.
- If `bun run --filter '*' dev` proves flaky, switch the root `dev` script to `concurrently 'bun --cwd apps/web dev' 'bun --cwd apps/server dev'` and add `concurrently` as a root devDependency (SPEC §4 sanctions this fallback).
