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

All on 2026-10-25.

| Slice | Commit | Summary | Tests at commit |
|---|---|---|---|
| L1 | `f57baea` | Schema, RLS, immutability triggers, publish/decision/rate-limit routines | 20 DB tests pass; RLS mutation check fails as expected when weakened |
| L2 | `6baf777` | Server-side Supabase session + anonymous sign-in, service-role review adapter, repository, error contract, origin check | 26 pass |
| L3 | `196ad0c` | Landing, workspace, project, change editor (local draft, manual items, fee preview), version page, pricing | 49 pass; production build OK |
| L4 | `3ae5fbd` | `extract_scope_changes` adapter, evidence validation, one repair, 30 s deadline, DB rate limits, `/analyse` | 61 pass |
| L5 | `01425e9` | `/publish` with idempotent key, server fee, atomic link rotation | 67 pass |
| L6 | `5145bc1` | Review page, bearer snapshot and decision routes | 74 pass |
| L7 | `40719a9` | Export (HTML/JSON), journey tests, live checks, bundle scan, docs | 78 pass; clean `npm ci`, lint, typecheck, build, bundle scan OK |

## Compatibility notes

- Next.js 16 scaffold enabled `cacheComponents`; it was turned off so `export const dynamic = "force-dynamic"` and explicit `no-store` headers define caching for personalised routes.
- Next.js 16 renamed `middleware.ts` to `proxy.ts`; the session refresh lives in `src/proxy.ts`.
- `params`/`searchParams` are Promises in Next.js 16 and are awaited everywhere.
- `@types/node` pinned to 22 (vitest 5 peer range; runtime is Node 22).
- The strict tool `input_schema` omits `maxItems`; item limits are enforced by Zod after the call.
- `MODEL_ID` stays `claude-haiku-5-5` as specified. Its availability has not been verified yet (no API key in the build environment); `tests/live/anthropic.live.test.ts` checks it with `models.retrieve` before any claim is made.

## Existing vs new work

All application code, SQL, tests and documents in this repository were written for this entry. Third-party material is limited to the npm packages listed above and Google Fonts served through `next/font` (SIL OFL). No assets or code were reused from other hackathon submissions.
