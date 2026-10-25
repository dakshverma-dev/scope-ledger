import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "./helpers/db";
import { NORTHLIGHT_PUBLISH } from "./helpers/fixtures";
import { pgliteOwnerRepository, pgliteReviewRepository } from "./helpers/pglite-repo";
import { current, get, ORIGIN, params, post } from "./helpers/routes";

vi.mock("@/lib/auth/session", async () => {
  const { AppError } = await import("@/lib/http/errors");
  const { current } = await import("./helpers/routes");
  const need = async () => {
    if (!current.owner) throw new AppError("UNAUTHENTICATED");
    return current.owner;
  };
  return { requireOwnerRepository: need, ensureAnonymousVisitor: need, getOwnerRepository: async () => current.owner };
});
vi.mock("@/lib/db/admin", async () => {
  const { current } = await import("./helpers/routes");
  return { reviewRepository: () => current.review };
});

const { POST: publish } = await import("@/app/api/projects/[id]/publish/route");
const { GET: getReview } = await import("@/app/api/review/[token]/route");
const { POST: decide } = await import("@/app/api/review/[token]/decision/route");
const { startDemo } = await import("@/lib/services/workspace");

let db: TestDb;
let projectId: string;
beforeEach(async () => {
  process.env.APP_BASE_URL = ORIGIN;
  db = await createTestDb();
  current.owner = pgliteOwnerRepository(db, await db.newVisitor());
  current.review = pgliteReviewRepository(db);
  projectId = await startDemo(current.owner);
});

async function publishV(overrides = {}) {
  const res = await publish(post(`/api/projects/${projectId}/publish`, NORTHLIGHT_PUBLISH(overrides)), params({ id: projectId }));
  const body = await res.json();
  return { ...body, token: String(body.reviewUrl).split("/review/")[1] } as { versionId: string; token: string; reviewUrl: string };
}
const view = (token: string) => getReview(get(`/api/review/${token}`), params({ token }));
const submit = (token: string, body: unknown, headers: Record<string, string> = {}) =>
  decide(post(`/api/review/${token}/decision`, body, headers), params({ token }));
const ACCEPT = { decision: "accepted", declaredName: "Demo Client" };

describe("GET /api/review/[token]", () => {
  it("shows only the allowlisted current snapshot to a valid bearer", async () => {
    const v1 = await publishV();
    const res = await view(v1.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.json();
    expect(body).toMatchObject({
      versionNumber: 1,
      projectName: "Northlight website refresh",
      clientName: "Northlight Studio",
      originalFeePence: 180000,
      ratePence: 9000,
      effortMinutes: 90,
      extraFeePence: 13500,
      revisedTotalPence: 193500,
      revisedDueOn: "2026-11-11",
      originalDueOn: "2026-11-09",
      decision: null,
    });
    const text = JSON.stringify(body);
    for (const secret of [v1.versionId, projectId, current.owner!.userId, "publishKey", "request", "sourceQuote", "token_hash"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("gives wrong, guessed, revoked, expired and superseded tokens the identical unavailable response", async () => {
    const input = NORTHLIGHT_PUBLISH();
    const v1 = await publishV(input);
    // Same key again: rotates v1's link (revoking the first one) without a new version.
    const rotated = await publishV({ ...input });
    expect(rotated.versionId).toBe(v1.versionId);
    // Version 2 supersedes the rotated link.
    const v2 = await publishV({ expectedCurrentVersionId: v1.versionId, effortMinutes: 120 });

    const candidates = {
      malformed: "short",
      guessed: "A".repeat(43),
      revoked: v1.token,
      superseded: rotated.token,
    };
    const bodies = new Set<string>();
    for (const [label, token] of Object.entries(candidates)) {
      const res = await view(token);
      expect(res.status, label).toBe(404);
      bodies.add(await res.text());
    }
    await db.admin("alter table public.review_tokens disable trigger review_tokens_revoke_only");
    await db.admin("update public.review_tokens set created_at = now() - interval '8 days', expires_at = now() - interval '1 second' where revoked_at is null");
    await db.admin("alter table public.review_tokens enable trigger review_tokens_revoke_only");
    const expired = await view(v2.token);
    expect(expired.status).toBe(404);
    bodies.add(await expired.text());
    expect(bodies.size).toBe(1);
    expect(JSON.parse([...bodies][0])).toEqual({ error: { code: "UNAVAILABLE", message: "This review link is unavailable." } });
  });
});

describe("POST /api/review/[token]/decision", () => {
  it("records one accepted event; identical replay is harmless; opposite replay is 409", async () => {
    const v1 = await publishV();
    const first = await submit(v1.token, { ...ACCEPT, note: "Looks good" });
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ status: "created", decision: "accepted", declaredName: "Demo Client", note: "Looks good" });
    const replay = await submit(v1.token, { ...ACCEPT, note: "Looks good" });
    expect(replay.status).toBe(200);
    expect((await replay.json()).status).toBe("replayed");
    const opposite = await submit(v1.token, { decision: "revision_requested", declaredName: "Demo Client" });
    expect(opposite.status).toBe(409);
    expect((await opposite.json()).error.code).toBe("DECISION_CONFLICT");
    expect(await db.admin("select id from public.decision_events")).toHaveLength(1);
    const after = await (await view(v1.token)).json();
    expect(after.decision).toMatchObject({ decision: "accepted", declaredName: "Demo Client" });
  });

  it("two simultaneous opposite decisions produce one event and one conflict", async () => {
    const v1 = await publishV();
    const [a, b] = await Promise.all([
      submit(v1.token, ACCEPT),
      submit(v1.token, { decision: "revision_requested", declaredName: "Demo Client" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await db.admin("select id from public.decision_events")).toHaveLength(1);
  });

  it("rejects money or extra fields from the reviewer and never changes the stored amount", async () => {
    const v1 = await publishV();
    for (const body of [
      { ...ACCEPT, extraFeePence: 1 },
      { ...ACCEPT, revisedTotalPence: 1 },
      { ...ACCEPT, effortMinutes: 15 },
      { decision: "accepted", declaredName: "" },
      { decision: "accepted", declaredName: "x".repeat(101) },
      { ...ACCEPT, note: "n".repeat(1001) },
      { decision: "approve", declaredName: "Demo Client" },
    ]) {
      expect((await submit(v1.token, body)).status).toBe(422);
    }
    expect((await submit(v1.token, ACCEPT)).status).toBe(201);
    expect(await db.admin("select extra_fee_pence, revised_total_pence from public.change_versions")).toEqual([
      { extra_fee_pence: 13500, revised_total_pence: 193500 },
    ]);
  });

  it("requires a same-origin request", async () => {
    const v1 = await publishV();
    expect((await submit(v1.token, ACCEPT, { origin: "https://evil.example" })).status).toBe(403);
    const noOrigin = new Request(`${ORIGIN}/api/review/${v1.token}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost:3000" },
      body: JSON.stringify(ACCEPT),
    });
    expect((await decide(noOrigin, params({ token: v1.token }))).status).toBe(403);
    expect(await db.admin("select id from public.decision_events")).toHaveLength(0);
  });

  it("an old version's link cannot approve version 2; version 1's accepted record stays £135.00", async () => {
    const v1 = await publishV();
    expect((await submit(v1.token, ACCEPT)).status).toBe(201);
    const v2 = await publishV({ expectedCurrentVersionId: v1.versionId, effortMinutes: 120 });

    const oldLink = await submit(v1.token, ACCEPT);
    expect(oldLink.status).toBe(404);
    expect((await oldLink.json()).error.code).toBe("UNAVAILABLE");
    expect((await view(v2.token)).status).toBe(200);
    expect(await (await view(v2.token)).json()).toMatchObject({ versionNumber: 2, extraFeePence: 18000, decision: null });

    const rows = await db.admin<Record<string, unknown>>(
      "select v.version_number, v.extra_fee_pence, d.decision from public.change_versions v left join public.decision_events d on d.change_version_id = v.id order by v.version_number",
    );
    expect(rows).toEqual([
      { version_number: 1, extra_fee_pence: 13500, decision: "accepted" },
      { version_number: 2, extra_fee_pence: 18000, decision: null },
    ]);
  });
});
