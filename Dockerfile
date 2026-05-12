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

RUN bun run --filter @arcadeai/web build

ENV DATABASE_PATH=/data/arcadeai.db

EXPOSE 3000

CMD ["sh", "-c", "bun run db:migrate && bun run apps/server/src/index.ts"]
