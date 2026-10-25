import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "./helpers/db";
import { NORTHLIGHT_PUBLISH } from "./helpers/fixtures";
import { pgliteOwnerRepository, pgliteReviewRepository } from "./helpers/pglite-repo";
import { current, ORIGIN, params, post } from "./helpers/routes";

vi.mock("@/lib/auth/session", async () => {
  const { AppError } = await import("@/lib/http/errors");
  const { current } = await import("./helpers/routes");
  const need = async () => {
    if (!current.owner) throw new AppError("UNAUTHENTICATED");
    return current.owner;
  };
  return { requireOwnerRepository: need, ensureAnonymousVisitor: need, getOwnerRepository: async () => current.owner };
});

const { POST: publish } = await import("@/app/api/projects/[id]/publish/route");
const { startDemo } = await import("@/lib/services/workspace");
const { hashToken } = await import("@/lib/domain/tokens");

let db: TestDb;
let projectId: string;
beforeEach(async () => {
  process.env.APP_BASE_URL = ORIGIN;
  db = await createTestDb();
  current.owner = pgliteOwnerRepository(db, await db.newVisitor());
  projectId = await startDemo(current.owner);
});

const call = (body: unknown, id = projectId, headers: Record<string, string> = {}) =>
  publish(post(`/api/projects/${id}/publish`, body, headers), params({ id }));
const versions = () => db.admin("select id from public.change_versions");
const tokenOf = (url: string) => url.split("/review/")[1];

describe("POST /api/projects/[id]/publish", () => {
  it("publishes version 1 at 90 minutes for £135.00 and returns a one-time review link", async () => {
    const res = await call(NORTHLIGHT_PUBLISH());
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ versionNumber: 1, extraFeePence: 13500, revisedTotalPence: 193500, created: true });
    expect(body.reviewUrl).toMatch(/^http:\/\/localhost:3000\/review\/[A-Za-z0-9_-]{43}$/);
    const [{ token_hash }] = await db.admin<{ token_hash: string }>("select token_hash from public.review_tokens");
    expect(token_hash).toBe(hashToken(tokenOf(body.reviewUrl)));
    expect(JSON.stringify(await db.admin("select * from public.review_tokens"))).not.toContain(tokenOf(body.reviewUrl));
  });

  it("is idempotent per publishKey: same version, fresh link, old link revoked", async () => {
    const input = NORTHLIGHT_PUBLISH();
    const first = await (await call(input)).json();
    const retry = await call({ ...input, effortMinutes: 2400 });
    expect(retry.status).toBe(200);
    const second = await retry.json();
    expect(second).toMatchObject({ versionId: first.versionId, versionNumber: 1, extraFeePence: 13500, created: false });
    expect(second.reviewUrl).not.toBe(first.reviewUrl);
    expect(await versions()).toHaveLength(1);
    const review = pgliteReviewRepository(db);
    expect(await review.getSnapshot(hashToken(tokenOf(first.reviewUrl)))).toBeNull();
    expect(await review.getSnapshot(hashToken(tokenOf(second.reviewUrl)))).toMatchObject({ extraFeePence: 13500 });
  });

  it("rejects client-supplied money and invalid effort with 422 and publishes nothing", async () => {
    for (const body of [
      { ...NORTHLIGHT_PUBLISH(), extraFeePence: 1 },
      { ...NORTHLIGHT_PUBLISH(), revisedTotalPence: 1 },
      NORTHLIGHT_PUBLISH({ effortMinutes: 0 }),
      NORTHLIGHT_PUBLISH({ effortMinutes: -15 }),
      NORTHLIGHT_PUBLISH({ effortMinutes: 16 }),
      NORTHLIGHT_PUBLISH({ effortMinutes: 89 }),
      NORTHLIGHT_PUBLISH({ effortMinutes: 2415 }),
      NORTHLIGHT_PUBLISH({ revisedDueOn: "2026-11-08" }),
      NORTHLIGHT_PUBLISH({ revisedDueOn: "2026-02-31" }),
      { ...NORTHLIGHT_PUBLISH(), confirmed: false },
      NORTHLIGHT_PUBLISH({ approvedItems: [{ ...NORTHLIGHT_PUBLISH().approvedItems[0], baselineItemIds: ["B9"] }] }),
    ]) {
      const res = await call(body);
      expect(res.status, JSON.stringify(body).slice(0, 120)).toBe(422);
      const err = await res.json();
      expect(err.error.code).toBe("VALIDATION_FAILED");
      expect(typeof err.error.message).toBe("string");
    }
    const malformed = await publish(post(`/api/projects/${projectId}/publish`, "{bad"), params({ id: projectId }));
    expect(malformed.status).toBe(422);
    const oversized = await call({ ...NORTHLIGHT_PUBLISH(), requestText: "x".repeat(40000) });
    expect(oversized.status).toBe(422);
    expect(await versions()).toHaveLength(0);
  });

  it("returns 409 for a stale expectation and publishes version 2 at 120 minutes for £180.00", async () => {
    const v1 = await (await call(NORTHLIGHT_PUBLISH())).json();
    const stale = await call(NORTHLIGHT_PUBLISH({ expectedCurrentVersionId: null }));
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe("STALE_VERSION");
    const v2 = await call(NORTHLIGHT_PUBLISH({ expectedCurrentVersionId: v1.versionId, effortMinutes: 120 }));
    expect(v2.status).toBe(201);
    expect(await v2.json()).toMatchObject({ versionNumber: 2, extraFeePence: 18000, revisedTotalPence: 198000 });
    const [old] = await db.admin<Record<string, unknown>>("select extra_fee_pence, effort_minutes from public.change_versions where version_number = 1");
    expect(old).toEqual({ extra_fee_pence: 13500, effort_minutes: 90 });
  });

  it("denies missing sessions (401), other owners (404) and cross-site requests (403)", async () => {
    const owner = current.owner;
    current.owner = null;
    const anon = await call(NORTHLIGHT_PUBLISH());
    expect(anon.status).toBe(401);
    expect(await anon.json()).toEqual({ error: { code: "UNAUTHENTICATED", message: expect.any(String) } });

    current.owner = pgliteOwnerRepository(db, await db.newVisitor());
    expect((await call(NORTHLIGHT_PUBLISH())).status).toBe(404);
    expect((await call(NORTHLIGHT_PUBLISH(), "not-a-uuid")).status).toBe(404);

    current.owner = owner;
    expect((await call(NORTHLIGHT_PUBLISH(), projectId, { origin: "https://evil.example" })).status).toBe(403);
    expect(await versions()).toHaveLength(0);
  });

  it("a database failure mid-transaction leaves no partial version, pointer or link", async () => {
    await db.admin(`create function public.fail_insert() returns trigger language plpgsql as $$ begin raise exception 'disk full'; end $$`);
    await db.admin("create trigger simulate_failure before insert on public.review_tokens for each row execute function public.fail_insert()");
    const res = await call(NORTHLIGHT_PUBLISH());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).toMatch(/Nothing was published/);
    expect(body.error.message).not.toContain("disk full");
    expect(await versions()).toHaveLength(0);
    expect(await db.admin("select current_version_id from public.projects")).toEqual([{ current_version_id: null }]);
    expect(await db.admin("select id from public.review_tokens")).toHaveLength(0);
  });
});
