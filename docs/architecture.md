# Architecture

## Data flow

```
Browser (consultant)                     Next.js server (Vercel)                    Supabase Postgres
────────────────────                     ───────────────────────                    ─────────────────
Try the demo ──POST /api/demo──────────► random 32-byte secret → HttpOnly cookie   visitors (SHA-256 only)
                                          resolve_visitor(hash) ───────────────► seed_demo_project(visitor)
Change editor (local draft) ─POST analyse► Zod → begin_analysis_run() ──────────► rate limit + run row
                                          Anthropic tool call (≤30 s, ≤1 repair)
                                          quote + baseline-ID validation
                                          complete_analysis_run() ──────────────► usage, model, status
            ─POST publish──────────────► Zod (strict, no money fields)
                                          token = 32 random bytes; hash = SHA-256
                                          publish_change_version() ─────────────► ONE transaction
            ◄── reviewUrl (shown once) ──
Client (no account)
/review/[token] ──GET──────────────────► hash(token) → get_review_snapshot()       (service role, allowlisted JSON)
Accept ─POST /decision─────────────────► same-origin, Zod → record_review_decision() ► ONE transaction
Owner ─GET /api/changes/[id]/export────► RLS read as the owner → escaped HTML / JSON
```

There is no sign-in. The browser never receives a Supabase client or key. All Supabase calls run on the server with the service-role key, and every call is to a `SECURITY DEFINER` routine that checks the visitor ID (resolved from the cookie hash) or the review-token hash. No code reads tables directly.

## Code layout

| Path | Responsibility |
|---|---|
| `supabase/migrations/` | Tables, constraints, RLS, immutability triggers, transactional routines, grants |
| `src/lib/domain/` | Pure validation (Zod), money, tokens, evidence matching. Shared by server and client |
| `src/lib/db/` | Repository interface, one RPC-based implementation (`rpc-repository.ts`, also used by tests), error mapping, service-role client (`admin.ts`, server-only) |
| `src/lib/auth/` | Visitor cookie and page helpers (server-only) |
| `src/lib/ai/` | `extract_scope_changes` schema, post-validation, bounded hosted-model extractor, built-in rules extractor |
| `src/lib/services/` | Business rules used by routes and pages |
| `src/app/api/` | Route handlers: JSON in/out, `{ error: { code, message } }` on failure |
| `tests/` | PGlite-backed DB, route and AI tests; `tests/live/` real-service checks |

## Row ownership

- A visitor is a row in `visitors` holding only the SHA-256 of the cookie secret. `resolve_visitor(hash)` maps a cookie to a visitor ID; forged, unknown or malformed cookies resolve to nothing.
- `projects.user_id` (a visitor ID) is the root of ownership; every owner routine takes the visitor ID and filters or checks it. `change_versions` and `analysis_runs` carry `user_id` with a **composite foreign key `(project_id, user_id) → projects(id, user_id)`**, so a child row cannot point at another owner's project.
- `review_tokens` and `projects.current_version_id` use composite keys `(version_id, project_id)`, so a link or pointer cannot reference a version of a different project.
- RLS is enabled on all six tables with no policies, and Supabase's default grants to `anon`/`authenticated` are revoked, so the publishable key can read or write nothing (tested for every table).
- Function `EXECUTE` is revoked from `PUBLIC`, `anon` and `authenticated`; every app routine is executable by `service_role` only (tested).
- Owner reads (`owner_*`) never return `user_id` or token hashes; `owner_get_active_link` returns only version, expiry and creation time.
- Mutation check: removing the visitor filter from `owner_get_project` makes the isolation tests fail.

## Invariants enforced in the database

| Invariant | Mechanism |
|---|---|
| Baseline 1–10 unique IDs, text 1–500; names 1–100; fee 0–100,000,000; rate 1–100,000 | `CHECK` + `private.is_valid_baseline` |
| Free allowance: one active project | `create_project`/`seed_demo_project` under a per-user advisory lock |
| Effort 15–2400, multiple of 15 | `CHECK` |
| `extra_fee_pence = floor((rate × effort + 30) / 60)` from the snapshot rate | `CHECK`; `revised_total_pence` is a generated column |
| Approved items: 1–10, known keys only, baseline IDs exist, manual items carry no quote | `CHECK` + `private.is_valid_approved_items` |
| `UNIQUE (project_id, version_number)`, `UNIQUE (project_id, publish_key)` | constraints |
| One live link per project | partial unique index `WHERE revoked_at IS NULL` |
| One terminal decision per version | `UNIQUE (change_version_id)` |
| Published versions and decisions never change | `BEFORE UPDATE/DELETE/TRUNCATE` triggers (apply to every role) |
| Baseline fields never change | trigger allowing only `current_version_id`/`archived_at` updates |
| Links can only be revoked, never un-revoked or extended | trigger |
| Analysis run completes once | trigger: only `pending → success/failure` |

## Publication transaction (`publish_change_version`)

Runs as one Postgres transaction (a single RPC):

1. Check the visitor exists; lock the project row `FOR UPDATE` (missing or not owned → `NOT_FOUND`).
2. If `(project_id, publish_key)` exists → **idempotent retry**: if it is still the current version, keep it unchanged (no new number, no content change); otherwise `STALE_VERSION`.
3. Else check `expectedCurrentVersionId` equals the current pointer (`STALE_VERSION` → 409), validate effort, date and items, insert the snapshot (baseline items, fee, rate, due date copied from the locked row) with `version_number = max + 1` and the fee computed from the locked rate, then move `current_version_id`.
4. Revoke every live link for the project and insert the new token hash with `expires_at = now() + 7 days`.
5. Return version, fee and expiry. The plaintext token is generated in Node with `crypto.randomBytes(32)` and returned to the owner only after the commit.

A failure at any step rolls back everything: `tests/api.publish.test.ts` injects a failure on the token insert and verifies there is no version, pointer change or link.

## Decision transaction (`record_review_decision`)

1. Look up the token by hash. Lock the **project** row `FOR UPDATE`, which serialises decisions against each other and against publication.
2. Re-read the token after the lock (a concurrent publish may have revoked it). Revoked, expired, superseded (not the current version) or archived → `UNAVAILABLE`.
3. If a decision exists: identical decision, name and note → return it (`replayed`, HTTP 200); anything else → `DECISION_CONFLICT` (409).
4. Insert the event (`UNIQUE` is a second guard). Prices and dates are never read from the request.

## Bearer-token threat model

| Threat | Mitigation |
|---|---|
| Guessing a link | 256-bit random token; only SHA-256 stored |
| Database leak exposes live links | Only hashes stored; `token_hash` not readable by visitors |
| Distinguishing revoked/expired/superseded/unknown links | One code path returns `null`/`UNAVAILABLE`; identical 404 body (tested) |
| Old link approving a new version | Decision requires token's version = project's current version, checked under lock |
| Leak via Referer, caching, indexing | `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store`, `noindex` |
| Leak in logs/exports | Tokens never logged; export contains no token, key or owner ID (tested) |
| CSRF on decision/owner POSTs | `Origin` must match `APP_BASE_URL`/request origin; otherwise `Sec-Fetch-Site: same-origin` required |
| Reviewer tampering with money | Strict Zod schema (unknown keys → 422); routine reads amounts from the immutable version |
| Reviewer gaining data access | Service role only calls two routines that return an allowlisted JSON object (no IDs, request text or quotes) |
| Script injection in export | All user text HTML-escaped; export response has `Content-Security-Policy: default-src 'none'` |

## Request analysis

Two engines share one contract. With `ANTHROPIC_API_KEY` set, the hosted model named by `MODEL_ID` is called. Without it, `src/lib/ai/rules-model.ts` answers: it splits the request into clauses at sentence and conjunction boundaries (keeping exact character spans, so quotes are literal), maps each clause to baseline items by shared content words and synonym groups, and classifies by wording (additive words give potential addition; questions, hedges or no matching baseline item give unclear). Its reply uses the same `extract_scope_changes` tool format and goes through the same validation and run recording, with model ID `scope-ledger-rules-1` and zero token usage.

Hosted model details:

- Server-only (`src/lib/ai/extract.ts`), model from `MODEL_ID` (`claude-haiku-5-5`), forced `tool_choice` on `extract_scope_changes` with `strict: true`, `max_tokens` 2048, no SDK retries.
- Input: only the baseline items and the request text, delimited and labelled as data. The system prompt is the specification wording.
- Post-validation, no exceptions: exact tool name; strict Zod shape (unknown fields rejected, bounded strings, ≤10 items); each baseline ID must exist in this project; each `sourceQuote` must be a substring of the request after **whitespace-only** normalisation (case and punctuation must match).
- On failure, one repair request feeds back the validation errors (as an error `tool_result`). A single 30-second deadline covers both requests via `AbortController`.
- Failures (timeout, model unavailable, upstream error, refusal, invalid output) are stored as `failure` runs and returned as 503 *Analysis unavailable*; the draft is untouched and manual entry remains available.
- `analysis_runs` stores the validated result, the model ID reported by the API response, input/output token usage and attempt count. No reasoning, prompts or keys are stored.
- Rate limits are counted from `analysis_runs` under a per-user advisory lock (so they hold across stateless Vercel instances). Every attempt counts, including failures.

## Workspace cookie

`src/lib/auth/session.ts`: `POST /api/demo` creates a 32-byte random secret (base64url), stores it in the `sl_visitor` cookie (`HttpOnly`, `SameSite=Lax`, `Secure` in production, 180 days) and registers only its SHA-256. Every later request hashes the cookie and calls `resolve_visitor`. State-changing routes also require a same-origin `Origin`. Consultant and review pages are `force-dynamic` and served with `Cache-Control: private, no-store`; the scaffold's `cacheComponents` was turned off so this route-segment model applies.

## Deployment variables

See the README table. `NEXT_PUBLIC_*` names are kept for the required contract, but because only server code reads them they are not inlined into browser bundles; `npm run check:bundle` verifies that no secret names, configured secret values or Supabase client code reach `.next/static`.

## Design choices beyond the specification

- `visitors` replaces Supabase Auth users (migration `20261025000200_cookie_visitors.sql`).
- `projects.seed_key` marks the one seeded demo project so seeding is idempotent per visitor.
- `review_tokens.project_id` enables the one-live-link-per-project index; `decision_events.review_token_id` records which link was used.
- `analysis_runs.failure_code`, `attempts` and `completed_at` add provenance.
- The publish payload requires `confirmed: true`, the explicit human approval step.
- Free-allowance and rate-limit failures return 429.
- Unknown/malformed/other-owner IDs return 404 (not 403) so existence is not revealed.
