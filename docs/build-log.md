# Build log

Original-work record for the Galuxium Nexus V2 entry. Every line below was produced in this
repository; nothing was carried over from an earlier hackathon submission.

- **Repository created:** 2026-10-25 (inside the 15 July – 31 October 2026 event window), `git init` in a fresh `scope-ledger` directory.
- **Scaffold:** `create-next-app@16.4.3` (TypeScript, ESLint, App Router, `src/`, `@/*`, no Tailwind). Default sample page and SVGs removed.
- **Runtime:** Node v22.19.0, npm 11.14.0.

## Pinned packages (exact versions in package.json / package-lock.json)

| Package | Version | Purpose |
|---|---|---|
| next | 16.4.3 | App Router framework |
| react / react-dom | 19.3.0 | UI |
| @supabase/supabase-js | 2.118.0 | Postgres/Auth client |
| @supabase/ssr | 0.12.7 | Cookie-based SSR session |
| zod | 4.6.7 | Runtime validation |
| @anthropic-ai/sdk | 1.3.0 | Server-side model call |
| server-only | 0.0.1 | Build-time guard for privileged modules |
| vitest (dev) | 5.0.5 | Tests |
| @electric-sql/pglite (dev) | 0.5.11 | In-process PostgreSQL 18 for migration/RLS tests |

## Steps

| Date | Slice | Notes | Commit |
|---|---|---|---|
| 2026-10-25 | L1 | Schema, RLS, immutability triggers, publish/decision/rate-limit routines, 20 PGlite tests; RLS mutation check confirmed the isolation test fails when the policy is weakened | see `git log` |
