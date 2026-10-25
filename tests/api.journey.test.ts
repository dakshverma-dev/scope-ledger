import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, pgliteRpc, type TestDb } from "./helpers/db";
import { NORTHLIGHT_REQUEST } from "./helpers/fixtures";
import { ownerRepository, reviewRepository } from "@/lib/db/rpc-repository";
import { current, get, ORIGIN, params, post } from "./helpers/routes";

vi.mock("@/lib/auth/session", async () => {
  const { AppError } = await import("@/lib/http/errors");
  const { current } = await import("./helpers/routes");
  const need = async () => {
    if (!current.owner) throw new AppError("UNAUTHENTICATED");
    return current.owner;
  };
  return { requireOwnerRepository: need, ensureVisitor: need, getOwnerRepository: async () => current.owner };
});
vi.mock("@/lib/db/admin", async () => {
  const { current } = await import("./helpers/routes");
  return { reviewRepository: () => current.review };
});
const { POST: demo } = await import("@/app/api/demo/route");
const { POST: analyse } = await import("@/app/api/projects/[id]/analyse/route");
const { POST: publish } = await import("@/app/api/projects/[id]/publish/route");
const { GET: review } = await import("@/app/api/review/[token]/route");
const { POST: decide } = await import("@/app/api/review/[token]/decision/route");
const { GET: exportRecord } = await import("@/app/api/changes/[id]/export/route");

let db: TestDb;
beforeEach(async () => {
  process.env.APP_BASE_URL = ORIGIN;
  delete process.env.ANTHROPIC_API_KEY;
  db = await createTestDb();
  current.owner = ownerRepository(pgliteRpc(db), await db.newVisitor());
  current.review = reviewRepository(pgliteRpc(db));
});

const exp = (id: string, format: string) => exportRecord(get(`/api/changes/${id}/export?format=${format}`), params({ id }));
const tokenOf = (url: string) => url.split("/review/")[1];

describe("Northlight demo journey through the real route handlers", () => {
  it("analyse → approve 90 min → publish v1 → accept → export → v2 at 120 min → history intact", async () => {
    // 1. Try the demo (idempotent).
    const { projectId } = await (await demo(post("/api/demo", {}))).json();
    expect((await (await demo(post("/api/demo", {}))).json()).projectId).toBe(projectId);

    // 2. Analyse the exact request.
    const a = await analyse(post(`/api/projects/${projectId}/analyse`, { requestText: NORTHLIGHT_REQUEST }), params({ id: projectId }));
    expect(a.status).toBe(200);
    const analysis = await a.json();
    expect(analysis.items.map((i: { sourceQuote: string }) => i.sourceQuote)).toEqual(["add two service pages", "a second round of revisions"]);
    expect(analysis.modelId).toBe("scope-ledger-rules-1");
    expect(analysis.items.map((i: { baselineItemIds: string[] }) => i.baselineItemIds)).toEqual([["B1"], ["B2"]]);

    // 3. Consultant edits one description, approves both, 90 minutes, 2026-11-11.
    const approvedItems = analysis.items.map(
      (i: { requestedChange: string; sourceQuote: string; baselineItemIds: string[]; classification: string }, n: number) => ({
        id: `ai-${n}`,
        description: n === 0 ? "Design and build two additional service pages" : i.requestedChange,
        baselineItemIds: i.baselineItemIds,
        origin: "ai_suggested",
        sourceQuote: i.sourceQuote,
        classification: i.classification,
      }),
    );
    const v1Body = { publishKey: randomUUID(), expectedCurrentVersionId: null, requestText: NORTHLIGHT_REQUEST, approvedItems, effortMinutes: 90, revisedDueOn: "2026-11-11", confirmed: true };
    const p1 = await publish(post(`/api/projects/${projectId}/publish`, v1Body), params({ id: projectId }));
    expect(p1.status).toBe(201);
    const v1 = await p1.json();
    expect(v1).toMatchObject({ versionNumber: 1, extraFeePence: 13500, revisedTotalPence: 193500 });

    // 4. Signed-out reviewer: no owner session at all.
    const owner = current.owner;
    current.owner = null;
    const t1 = tokenOf(v1.reviewUrl);
    const snap = await (await review(get(`/api/review/${t1}`), params({ token: t1 }))).json();
    expect(snap).toMatchObject({ versionNumber: 1, extraFeePence: 13500, revisedTotalPence: 193500, decision: null });
    const accepted = await decide(post(`/api/review/${t1}/decision`, { decision: "accepted", declaredName: "Demo Client" }), params({ token: t1 }));
    expect(accepted.status).toBe(201);
    current.owner = owner;

    // 5. Export v1 as HTML and JSON.
    const html = await exp(v1.versionId, "html");
    expect(html.headers.get("content-type")).toContain("text/html");
    expect(html.headers.get("content-security-policy")).toContain("default-src 'none'");
    const page = await html.text();
    for (const s of ["Northlight website refresh", "version 1", "£135.00", "£1,935.00", "Accepted", "Demo Client", "B1", "B2", "B3", "£1,800.00", "Wed, 11 Nov 2026"]) {
      expect(page).toContain(s);
    }
    const json1 = await exp(v1.versionId, "json");
    expect(json1.headers.get("content-disposition")).toMatch(/attachment; filename="scope-ledger-northlight-website-refresh-v1\.json"/);
    const record1 = await json1.json();
    expect(record1).toMatchObject({
      status: "accepted",
      version: { versionNumber: 1, effortMinutes: 90, extraFeePence: 13500, revisedTotalPence: 193500, revisedDueOn: "2026-11-11" },
      decision: { decision: "accepted", declaredName: "Demo Client" },
    });
    expect(record1.version.baselineSnapshot.baselineItems).toHaveLength(3);
    expect(JSON.stringify(record1)).not.toContain(t1);
    expect(JSON.stringify(record1)).not.toContain(owner!.userId);

    // 6. Revised version 2 from a copy of v1, 120 minutes.
    const p2 = await publish(
      post(`/api/projects/${projectId}/publish`, { ...v1Body, publishKey: randomUUID(), expectedCurrentVersionId: v1.versionId, effortMinutes: 120 }),
      params({ id: projectId }),
    );
    expect(p2.status).toBe(201);
    const v2 = await p2.json();
    expect(v2).toMatchObject({ versionNumber: 2, extraFeePence: 18000, revisedTotalPence: 198000 });

    // Old link cannot approve v2 (or see anything).
    current.owner = null;
    expect((await decide(post(`/api/review/${t1}/decision`, { decision: "accepted", declaredName: "Demo Client" }), params({ token: t1 }))).status).toBe(404);
    expect((await review(get(`/api/review/${t1}`), params({ token: t1 }))).status).toBe(404);
    current.owner = owner;

    // Version 1 export is unchanged: still £135.00 and accepted, with the same decision timestamp.
    const record1Again = await (await exp(v1.versionId, "json")).json();
    expect(record1Again.version).toEqual(record1.version);
    expect(record1Again.decision).toEqual(record1.decision);
    expect(record1Again.isCurrentVersion).toBe(false);
    expect(await (await exp(v1.versionId, "html")).text()).toContain("£135.00");
    expect((await (await exp(v2.versionId, "json")).json()).status).toBe("awaiting_decision");
  });
});

describe("export access and safety", () => {
  async function publishWith(requestText: string, description: string) {
    const { projectId } = await (await demo(post("/api/demo", {}))).json();
    const body = {
      publishKey: randomUUID(),
      expectedCurrentVersionId: null,
      requestText,
      approvedItems: [{ id: "m-1", description, baselineItemIds: ["B1"], origin: "manually_entered", sourceQuote: null, classification: null }],
      effortMinutes: 15,
      revisedDueOn: "2026-11-09",
      confirmed: true,
    };
    return (await publish(post(`/api/projects/${projectId}/publish`, body), params({ id: projectId }))).json();
  }

  it("escapes untrusted text in the HTML export", async () => {
    const v = await publishWith(`<script>alert("x")</script> & "quotes"`, `<img src=x onerror=alert(1)>`);
    const t = tokenOf(v.reviewUrl);
    await decide(post(`/api/review/${t}/decision`, { decision: "revision_requested", declaredName: "<b>Eve</b>", note: "</p><script>steal()</script>" }), params({ token: t }));
    const page = await (await exp(v.versionId, "html")).text();
    expect(page).not.toMatch(/<script/i);
    expect(page).not.toMatch(/<img/i);
    expect(page).not.toContain("<b>Eve</b>");
    expect(page).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;quotes&quot;");
    expect(page).toContain("&lt;b&gt;Eve&lt;/b&gt;");
    expect(page).toContain("Manually entered");
  });

  it("is owner-only: other visitors and signed-out callers cannot export", async () => {
    const v = await publishWith(NORTHLIGHT_REQUEST, "Two service pages");
    current.owner = ownerRepository(pgliteRpc(db), await db.newVisitor());
    const other = await exp(v.versionId, "json");
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual({ error: { code: "NOT_FOUND", message: expect.any(String) } });
    current.owner = null;
    expect((await exp(v.versionId, "html")).status).toBe(401);
  });

  it("validates the format parameter and supports Accept negotiation", async () => {
    const v = await publishWith(NORTHLIGHT_REQUEST, "Two service pages");
    expect((await exp(v.versionId, "pdf")).status).toBe(422);
    const negotiated = await exportRecord(
      new Request(`${ORIGIN}/api/changes/${v.versionId}/export`, { headers: { accept: "application/json" } }),
      params({ id: v.versionId }),
    );
    expect(negotiated.headers.get("content-type")).toContain("application/json");
  });
});
