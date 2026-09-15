# Local Supabase Stack

## Context

ArcadeAI currently stores application data in SQLite and uses Better Auth for Google and GitHub OAuth. This change adds a complete local Supabase CLI stack backed by Docker, with Postgres and Supabase Auth available for local development, while retaining the current production defaults until an operator intentionally changes them.

## Goals

- Run the local stack through `supabase start`, with non-default project-specific ports.
- Use Supabase Postgres and Supabase Auth in local development.
- Keep `packages/db` as the sole owner of application schema and migrations; do not add application tables to `supabase/migrations`.
- Provide local browser email/password authentication without external OAuth credentials.
- Validate Supabase JWTs against JWKS in the API and create application profiles on first authenticated request.
- Preserve the SQLite database file and offer an opt-in importer for existing application data.
- Keep Better Auth + SQLite as the production default.

## Non-Goals

- Migrating production data automatically.
- Importing Better Auth OAuth tokens, account links, or active sessions into Supabase Auth.
- Replacing the production authentication provider by default.
- Replacing RAG vector retrieval in local Postgres in this change.

## Design

`supabase/config.toml` defines a fully enabled Supabase local stack on the `553xx` port range: API gateway, Postgres, Auth, asymmetric JWT/JWKS, Auth Admin API, Studio, and Mailpit. Local email/password sign-up is enabled and confirmations are disabled so a fresh stack is immediately usable; Mailpit remains available for inspecting mail-related flows.

The server selects its runtime mode through `AUTH_MODE` and `DATABASE_URL`. The defaults retain the existing Better Auth/SQLite behavior. In `supabase` mode, the server connects to Postgres, verifies browser bearer tokens through the configured Supabase JWKS endpoint, and ensures the matching application profile exists. OAuth routes remain exclusive to Better Auth mode.

The web app selects Supabase local auth only when public Supabase configuration is supplied. In that mode it creates a Supabase browser client, attaches an access token to API requests, and presents email/password sign-up/sign-in controls. The existing OAuth UI remains the default when Supabase mode is absent.

Postgres application tables live in a dedicated application schema and reference Supabase `auth.users`. Their migration files remain owned and applied by `packages/db`; Supabase migrations only manage Supabase-owned initialization. A separate, opt-in importer copies application rows from the SQLite file into Postgres after users have been recreated in Supabase with matching IDs or mapped by email. It never modifies the SQLite source.

## Key Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Local orchestration | Supabase CLI + Docker | Uses the supported local workflow rather than maintaining Compose files. |
| Local ports | `55321` through `55329` | Avoids collisions with Supabase’s common defaults across local projects. |
| Migration ownership | `packages/db` only | Preserves a single source of truth for application tables. |
| Local auth | Supabase email/password | Works immediately without Google/GitHub credentials. |
| Production default | Better Auth + SQLite | Avoids an unrequested production behavior change. |
| Existing data | Opt-in importer | Protects the source database while providing a migration path for app data. |

## Rejected Alternatives

- Add Supabase containers but leave the app on SQLite — does not satisfy local Postgres migration or make the stack the application backend.
- Replace Better Auth in every environment — changes production behavior without an explicit deployment migration.
- Place application DDL in `supabase/migrations` — creates two migration owners and drift risk.

## Edge Cases & Constraints

- Existing OAuth users must authenticate again after moving to Supabase Auth; Better Auth sessions and OAuth credentials are not portable.
- `supabase db reset` drops local Postgres application data, so importing must be rerun only when desired.
- SQLite-only `sqlite-vec` RAG retrieval is unavailable in Postgres mode unless a later vector implementation is added.
- The importer must retain application IDs and map user ownership safely; unmatched users are reported rather than silently reassigned.

## Open Questions

None.
