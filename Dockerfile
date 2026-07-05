FROM oven/bun:1.2-debian

WORKDIR /app

RUN apt-get update && apt-get install -y sqlite3 && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock biome.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/

RUN bun install --frozen-lockfile

COPY . .

ENV VITE_API_BASE=""

RUN bun run --filter @arcadeai/web build

ENV DATABASE_PATH=/data/arcadeai.db

EXPOSE 3000

# `exec` replaces the shell with bun so bun (not sh) receives SIGTERM.
# Without it, sh runs as PID 1, ignores the stop signal, and Fly hard-kills
# the machine after the grace period — the graceful-shutdown handler in
# src/index.ts (30s SSE drain + app.close()) never runs in production.
CMD ["sh", "-c", "bun run db:migrate && exec bun apps/server/src/index.ts"]
