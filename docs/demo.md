# Northlight demo walkthrough

Everything is fictional. No emails, payments or signatures are involved. Use two browsers (or one normal window and one private window): **A** for the consultant, **B** signed out for the client.

## Fixture

| Field | Value |
|---|---|
| Project | Northlight website refresh |
| Client | Northlight Studio |
| B1 | Design and implement a three page responsive website |
| B2 | Include one round of revisions |
| B3 | Deliver the agreed pages by 2026-11-09 |
| Original fee | £1,800.00 (180000 pence) |
| Rate | £90.00/hour (9000 pence) |
| Due | 2026-11-09 |

## Script

1. **A:** open `/`, click **Try the demo**. The Northlight project opens with B1, B2, B3, £1,800.00, £90.00/hour and Mon, 9 Nov 2026.
2. **A:** click **Start a new client request**. Paste exactly: `Please add two service pages and a second round of revisions.` Click **Analyse request**.
   - Expected: two candidates, both *Potential addition*. Quotes `add two service pages` (B1) and `a second round of revisions` (B2) are highlighted in the request. Wording of descriptions may vary.
   - If analysis is unavailable, the request stays in the box: click **Add item manually** twice and enter the two items (they are labelled *Manually entered*).
3. **A:** edit a description if wanted, keep both approved, enter **90** minutes and revised date **2026-11-11**. The preview shows additional fee **£135.00** and revised total **£1,935.00**; status *Ready to publish*.
4. **A:** **Review and publish** → tick the approval → **Publish version 1**. Copy the review link shown on the version page.
5. **B:** open the link. It shows the original baseline, the two changes, £135.00 / £1,935.00 and Wed, 11 Nov 2026. Enter **Demo Client** and click **Accept**. The page now shows *Accepted*.
6. **A:** reload the version page: *Accepted*, declared name Demo Client, timestamp. Click **Export record (HTML)** and **Download JSON**; both show version 1, £135.00 and the accepted decision.
7. **A:** click **Create revised version**. The draft is a copy of version 1. Change effort to **120** and publish **version 2**: additional fee **£180.00**, revised total £1,980.00.
8. **B:** reload the old link: *Link expired or superseded*. It cannot approve version 2.
9. **A:** open version 1 again and export: still £135.00 and *Accepted*, with the original timestamp.

## Resetting the demo

Each browser is one anonymous workspace, limited to one active project. To start fresh, clear the site's cookies (or use a new private window) and click **Try the demo** again. Old anonymous workspaces stay in the database.

## Live verification checklist

Run on the deployed URL in a fresh browser profile, and record results in `docs/acceptance.md`.

- [ ] `/` loads signed out; **Try the demo** opens the Northlight project.
- [ ] Analysis returns two grounded items (live model); note model ID and usage from the `analysis_runs` row.
- [ ] Publish v1 at 90 min → £135.00 / £1,935.00; review link works in a signed-out window; Accept recorded.
- [ ] HTML and JSON exports match; JSON downloads as a file.
- [ ] v2 at 120 min → £180.00; old link shows the unavailable state; v1 export unchanged.
- [ ] A second browser's workspace cannot open the first browser's `/app/projects/<id>`, `/app/changes/<id>` or export URL (404).
- [ ] DevTools → Network: no request carries the service-role or Anthropic key; `/app` and `/review/*` responses have `Cache-Control: private, no-store`.
- [ ] `npm run test:live` passes against the production Supabase project.
