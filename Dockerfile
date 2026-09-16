FROM oven/bun:1.4.2-debian

WORKDIR /app

COPY package.json bun.lock bunfig.toml biome.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/

RUN bun install --frozen-lockfile

COPY . .

ENV VITE_API_BASE=""

RUN bun run --filter @arcadeai/web build

EXPOSE 3000

# Bun runs as PID 1 so it receives SIGTERM and can drain active SSE streams.
CMD ["bun", "apps/server/src/index.ts"]
