# ArcadeAI

Turn natural-language prompts into playable 2D browser games.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.1

## Setup

```bash
# Install dependencies
bun install

# Copy environment variables
cp .env.example .env
# Edit .env and fill in your API keys and OAuth credentials
```

## Development

```bash
bun run dev
```

- Web app: http://localhost:5173
- Server: http://localhost:3000

Smoke test:

```bash
curl http://localhost:3000/api/health
# → {"ok":true,"version":"0.0.1"}
```

## Build

```bash
bun run build
```

## Lint & Format

```bash
bun run lint    # check
bun run check   # lint + format together
bun run format  # format only
```

## Database

```bash
# Run migrations
DATABASE_PATH=./apps/server/data/arcadeai.db bun --cwd packages/db run migrate
```
