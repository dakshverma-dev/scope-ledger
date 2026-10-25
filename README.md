# Scope Ledger

**Keep client scope changes attached to an approved version and price.**

A solo consultant agrees fixed deliverables, a fee and a due date. Then the client asks for more. Scope Ledger compares the new request with the agreed baseline, quoting the exact words that point to extra work. The consultant sets the hours and the revised date, the server calculates the fee, and the consultant publishes one immutable version. The client opens a private link without an account and accepts or requests a revision. The owner can export the preserved record at any time.

> Illustrative prototype for Galuxium Nexus V2 using fictional client data (Northlight Studio). It does not collect payments, send email, generate contracts, verify identities or create e-signatures. A reviewer's declared name is self-reported.

- **Live app:** _not deployed yet — see [Deploying to Vercel](#deploying-to-vercel)_
- **Demo walkthrough:** [docs/demo.md](docs/demo.md)
- **Architecture and threat model:** [docs/architecture.md](docs/architecture.md)
- **Acceptance results:** [docs/acceptance.md](docs/acceptance.md)

## What works

| Area | Status |
|---|---|
| Anonymous workspace per browser, idempotent Northlight seed, 1 active project free cap | Implemented; DB-tested |
| Fixed baseline (B-items, fee, rate, due date), immutable after creation | Implemented; DB triggers tested |
| AI comparison with tool `extract_scope_changes`: literal quotes, real baseline IDs, one repair, 30 s deadline | Implemented; tested with fixture responses. **Live model call not yet verified** (no API key in the build environment) |
| 20 analyses/day and 3/minute per visitor, enforced in Postgres | Implemented; DB-tested |
| Manual items labelled *Manually entered*, local draft that survives errors and reloads | Implemented; unit-tested |
| Server-only fee: `Math.floor((ratePence * effortMinutes + 30) / 60)`, 15-minute effort steps | Implemented in TS and as a DB `CHECK`; tested |
| Atomic publish: immutable snapshot, version number, current pointer, link rotation; idempotent `publishKey` | Implemented in one SQL routine; tested incl. injected mid-transaction failure |
| Account-free review link (32-byte token, SHA-256 stored, 7-day expiry), uniform "unavailable" state | Implemented; tested |
| One terminal decision per version, identical replay idempotent, opposite = 409 | Implemented; tested |
| Owner export: escaped HTML and downloadable JSON | Implemented; tested |
| Pricing page with proposed £12/month Solo plan (disabled, "Coming later") | Implemented |

**Deliberately not built:** payments, Stripe, upgrades, invoices, contracts, e-signatures, identity verification, email sending, inbox integrations, teams, CRM, automatic effort or price estimates.

## Stack

Next.js 16.4.3 (App Router, TypeScript, `src/`, plain CSS) · Supabase Postgres + anonymous auth + RLS · Zod 4 · Anthropic SDK 1.3.0 (server only) · Vitest 5 + PGlite (in-process Postgres) for tests. Node **22** (developed on v22.19.0, npm 11.14.0). Exact versions are pinned in `package.json` and `package-lock.json`.

## Setup

```bash
npm ci
cp .env.example .env.local   # fill in the values below
npm run dev                  # http://localhost:3000
```

### Environment variables

| Name | Where used | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | server | Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | server | Publishable/anon key. Required name per spec; no client component reads it, so it is not shipped to the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Used solely by the two token-checked review routines |
| `ANTHROPIC_API_KEY` | server only | Without it, analysis returns *Analysis unavailable* and manual entry still works |
| `MODEL_ID` | server | `claude-haiku-5-5` per specification. Do not change it silently; record any change in `docs/build-log.md` |
| `APP_BASE_URL` | server | Public origin, used for review links and same-origin checks |

### Supabase

1. Create a Supabase project.
2. **Authentication → Sign In / Providers → enable "Allow anonymous sign-ins".** (Consider enabling CAPTCHA for anonymous sign-ins on a public deployment.)
3. Apply the migration in `supabase/migrations/` — either `supabase db push` with the Supabase CLI linked to the project, or paste `20261025000100_scope_ledger_core.sql` into the SQL editor and run it once.
4. Put the URL, publishable key and service-role key in `.env.local`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | 78 tests: migration/RLS/routines on PGlite, route handlers, AI validation, domain. No network |
| `npm run test:live` | Live checks against the real Supabase project and Anthropic API from `.env` / `.env.local` (skipped when values are absent). Creates throwaway anonymous users and rows |
| `npm run build` | Production build |
| `npm run check:bundle` | After a build: fails if server secret names/values or the Supabase client appear in browser assets |

## Deploying to Vercel

1. Push this repository to GitHub as `scope-ledger` and import it in Vercel (framework: Next.js; `vercel.json` sets `npm ci` + `npm run build`).
2. Add the six environment variables (Production and Preview). Mark the service-role and Anthropic keys as sensitive.
3. Deploy, then set `APP_BASE_URL` to the real deployment origin and redeploy.
4. Run the signed-out checklist in [docs/demo.md](docs/demo.md#live-verification-checklist).

## Security notes and known limitations

- Each browser is a separate Supabase **anonymous user**; clearing cookies loses access to that workspace.
- Review URLs are bearer capabilities. Anyone holding a live link can view that version and record the one decision. Links expire after 7 days and are revoked when a newer version is published or a new link is issued. The full link is only displayed when issued.
- The declared reviewer name is not verified. An accepted decision is an in-product record, not a signature or a legally binding acceptance.
- Published versions, decisions and baselines cannot be updated or deleted by any role, including the service role (triggers). As a consequence, deleting an anonymous user in Supabase fails once they have published; this demo has no account deletion.
- The PGlite test database runs one connection, so "simultaneous" tests interleave but do not run in parallel. True parallel locking is covered by `tests/live/supabase.live.test.ts`, which must be run against the real project.
- Analysis rate limits use a rolling 1-minute and 24-hour window.

## Licence

MIT — see [LICENSE](LICENSE). Fonts (Bricolage Grotesque, IBM Plex Sans, IBM Plex Mono) are served via `next/font` under the SIL Open Font License.
