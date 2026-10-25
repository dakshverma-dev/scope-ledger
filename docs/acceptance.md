# Acceptance results

Only results that were actually executed are marked as passed. Live-service checks are listed separately and are **not yet run**.

## Environment of the recorded run

| | |
|---|---|
| Date | 2026-10-25 |
| Commit | `40719a9` |
| OS / runtime | Windows 11, Node v22.19.0, npm 11.14.0 |
| Database for automated tests | PGlite 0.5.11 (PostgreSQL 18.6 in-process) with `tests/fixtures/supabase-shim.sql` recreating Supabase roles, `auth.uid()` and Supabase's default grants, then the real migration |
| Model calls in automated tests | Fixture responses only (`vi.fn` / mocked `anthropicCreateMessage`); no network |

## Commands and results

| Command | Result |
|---|---|
| `npm ci` (clean install from lockfile, `.next` removed) | OK, 0 vulnerabilities |
| `npm run lint` | 0 problems |
| `npm run typecheck` | 0 errors |
| `npm test` | **78 passed**, 5 skipped (the live suites; no credentials present) |
| `npm run build` | Compiled successfully; all consultant/review routes dynamic (`ƒ`), only `/`, `/pricing`, 404 static |
| `npm run check:bundle` | 19 browser asset files scanned, 0 findings. Verified the scanner fails (exit 1) on a planted `service_role` string |

Per file: `db.schema` 20 · `domain` 23 · `ai` 12 · `api.review` 7 · `api.publish` 6 · `repository.isolation` 6 · `api.journey` 4.

An RLS mutation check was also run: changing the `projects` policy to `using (true)` makes the isolation test fail ("projects: expected true to be false"); restoring it passes.

## Specification tests (section 11)

| # | Requirement | Evidence | Result |
|---|---|---|---|
| 1 | Happy path | `api.journey`: demo → analyse → edit → 90 min → publish → signed-out review → accept → HTML/JSON export → v2 | Pass |
| 2 | Math: 90 min → £135, 120 min → £180, half-up pennies | `domain` money tests (incl. 0.25p→0, 0.5p→1, 1.5p→2, 7498.5p→7499); DB `CHECK` and routine in `db.schema` | Pass |
| 3 | Validation: effort −15/0/16/17/89/>2400, bad dates, IDs, fee/rate, oversized, too many items | `domain`, `db.schema`, `api.publish` (all 422 with structured error) | Pass |
| 4 | Price tampering | `api.publish` (injected `extraFeePence`/`revisedTotalPence` → 422), `api.review` (reviewer money fields → 422, stored amount unchanged) | Pass |
| 5 | Evidence: invented quote, wrong substring, unknown B-ID rejected; unclear allowed; manual labelled | `ai` tests; `domain` evidence tests; manual label in export test | Pass |
| 6 | AI failure: timeout, malformed, unavailable model, bad repair → unavailable; no publication | `ai` tests (TIMEOUT within deadline, MODEL_UNAVAILABLE, UPSTREAM_ERROR, REFUSED, INVALID_OUTPUT after one repair; failure run stored, zero versions) | Pass |
| 7 | Isolation incl. exports | `db.schema` (RLS/grants as `authenticated`), `repository.isolation`, `api.journey` export 404 for other visitor, 401 signed out | Pass (PGlite). Live Supabase: **not run** |
| 8 | Tokens: wrong/expired/revoked/superseded/guessed identical | `api.review` (byte-identical 404 bodies across five cases), `db.schema` | Pass |
| 9 | Publish idempotency/concurrency | `db.schema`, `api.publish` (same key → same version, fresh link, old revoked; one live link) | Pass (serialised). True parallel connections: **not run** (`tests/live`) |
| 10 | Decision concurrency/idempotency | `api.review`, `db.schema` (one 201 + one 409, one event; identical replay 200) | Pass (serialised). True parallel connections: **not run** |
| 11 | Immutable history | `db.schema` (UPDATE/DELETE blocked for all roles), `api.journey` (v1 export identical after v2) | Pass |
| 12 | Limits: one active project; 3/min, 20/day | `db.schema`, `repository.isolation`, `ai` (4th call 429 before any model call) | Pass |
| 13 | Failure recovery: no partial publication, draft intact | `api.publish` injected mid-transaction failure → 500, no version/pointer/link; `domain` draft persistence; editor clears the draft only after a 2xx | Pass (draft UI behaviour reviewed in code, not browser-automated) |
| 14 | No-store, no secrets in bundle, escaped export | Response headers asserted in route tests; `check:bundle`; `api.journey` escaping test (no `<script>`/`<img>`, CSP `default-src 'none'`). Production server headers: `/app` → `private, no-store` (observed) | Pass |
| 15 | Clean install, lint, tests, build | Table above | Pass |

## Not yet verified (requires credentials or deployment)

| Check | How to run | Status |
|---|---|---|
| `claude-haiku-5-5` available to the account; live Northlight extraction, model ID and token usage | `npm run test:live` with `ANTHROPIC_API_KEY` | Not run — no key in build environment |
| Two real visitors isolated; publishable key reaches nothing; parallel decisions and publishes over separate connections | `npm run test:live` with Supabase values | Not run — no project configured for this app |
| Signed-out end-to-end demo on the deployed URL | `docs/demo.md` checklist | Not run — not deployed |

Record each result here with date, commit, command and output when run.
