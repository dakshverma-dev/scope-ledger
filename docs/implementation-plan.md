# Implementation plan

Repository created: **2026-10-25** (Galuxium Nexus V2 event window: 15 July – 31 October 2026).
Fixed order: each slice must meet its finish criterion before the next starts.

| Slice | Scope | Finish criterion |
|---|---|---|
| L1 | `supabase/migrations`: five tables, constraints, RLS, immutability triggers, `create_project`, `seed_demo_project`, `publish_change_version`, `record_review_decision`, `get_review_snapshot`, analysis rate-limit routines | PGlite schema tests: two anonymous identities isolated, publish idempotent, one terminal decision, snapshots immutable, free cap |
| L2 | `src/lib/auth`, `src/lib/db`: Supabase SSR session (server-side anonymous sign-in), server-only service-role client, repository adapter, `proxy.ts`, no-store/dynamic | Two sessions isolated through the same repository code used by routes |
| L3 | `src/lib/demo`, pages `/`, `/app`, `/app/projects/[id]`, `/app/projects/[id]/changes/new`, `/app/changes/[id]`, `/pricing`; manual item editor, effort, date, preview, local draft | Draft → preview works without AI, survives refresh/failure |
| L4 | `src/lib/ai`, `POST /api/projects/[id]/analyse`: `extract_scope_changes` tool, Zod, literal quote + baseline ID validation, one repair, 30 s deadline, 20/day + 3/min DB limiter, usage record | Northlight fixture validates; fabricated quote/ID and timeout tests pass |
| L5 | `src/lib/domain/money`, `POST /api/projects/[id]/publish`: integer fee formula, quarter-hour effort, publishKey idempotency, atomic snapshot + token rotation | v1 at 90 min → GBP 135.00, replay safe |
| L6 | `/review/[token]`, `GET /api/review/[token]`, `POST /api/review/[token]/decision` | One terminal event under concurrency; superseded token unavailable |
| L7 | `GET /api/changes/[id]/export`, pricing, docs, acceptance log, Vercel readiness | lint, tests, build pass; documented live-verification checklist |
