import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, sha256Hex, type TestDb } from "./helpers/db";

const NORTHLIGHT_REQUEST = "Please add two service pages and a second round of revisions.";
const ITEMS = [
  {
    id: "c1",
    description: "Add two service pages",
    baselineItemIds: ["B1"],
    origin: "ai_suggested",
    sourceQuote: "add two service pages",
    classification: "potential_addition",
  },
  {
    id: "c2",
    description: "Second round of revisions",
    baselineItemIds: ["B2"],
    origin: "ai_suggested",
    sourceQuote: "a second round of revisions",
    classification: "potential_addition",
  },
];

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});

async function seed(uid: string): Promise<string> {
  const [row] = await db.asUser<{ id: string }>(uid, "select public.seed_demo_project() as id");
  return row.id;
}

async function publish(
  uid: string,
  projectId: string,
  opts: { key?: string; expected?: string | null; effort?: number; due?: string; items?: unknown; token?: string } = {},
) {
  const token = opts.token ?? randomUUID();
  const [row] = await db.asUser<{ r: Record<string, unknown> }>(
    uid,
    "select public.publish_change_version($1, $2, $3, $4, $5::jsonb, $6, $7::date, $8) as r",
    [
      projectId,
      opts.key ?? randomUUID(),
      opts.expected ?? null,
      NORTHLIGHT_REQUEST,
      JSON.stringify(opts.items ?? ITEMS),
      opts.effort ?? 90,
      opts.due ?? "2026-11-11",
      await sha256Hex(token),
    ],
  );
  return { ...(row.r as { versionId: string; versionNumber: number; extraFeePence: number; revisedTotalPence: number; created: boolean }), token };
}

const snapshot = async (token: string) =>
  (await db.asService<{ s: Record<string, unknown> | null }>("select public.get_review_snapshot($1) as s", [await sha256Hex(token)]))[0].s;

const decide = async (token: string, decision: string, name = "Demo Client", note: string | null = null) =>
  (
    await db.asService<{ r: Record<string, unknown> }>("select public.record_review_decision($1, $2, $3, $4) as r", [
      await sha256Hex(token),
      decision,
      name,
      note,
    ])
  )[0].r;

describe("projects, demo seed and free allowance", () => {
  it("seeds Northlight idempotently per visitor with the exact fixture", async () => {
    const a = await db.newVisitor();
    const first = await seed(a);
    expect(await seed(a)).toBe(first);
    const [p] = await db.asUser<Record<string, unknown>>(a, "select * from public.projects");
    expect(p).toMatchObject({
      name: "Northlight website refresh",
      client_name: "Northlight Studio",
      original_fee_pence: 180000,
      rate_pence: 9000,
      current_version_id: null,
    });
    expect(p.baseline_items).toEqual([
      { id: "B1", text: "Design and implement a three page responsive website" },
      { id: "B2", text: "Include one round of revisions" },
      { id: "B3", text: "Deliver the agreed pages by 2026-11-09" },
    ]);
  });

  it("gives each anonymous visitor an isolated copy of the demo", async () => {
    const a = await db.newVisitor();
    const b = await db.newVisitor();
    expect(await seed(a)).not.toBe(await seed(b));
    expect(await db.asUser(a, "select id from public.projects")).toHaveLength(1);
    expect(await db.asUser(b, "select id from public.projects")).toHaveLength(1);
  });

  it("enforces one active project on the free allowance", async () => {
    const a = await db.newVisitor();
    await seed(a);
    await expect(
      db.asUser(a, "select public.create_project('Second', 'Client', $1::jsonb, 100, 100, '2026-12-01')", [
        JSON.stringify([{ id: "B1", text: "Thing" }]),
      ]),
    ).rejects.toThrow(/FREE_LIMIT_REACHED/);
  });

  it("validates baseline shape and money ranges in the database", async () => {
    const a = await db.newVisitor();
    const create = (items: unknown, fee = 100, rate = 100, name = "P") =>
      db.asUser(a, "select public.create_project($1, 'Client', $2::jsonb, $3, $4, '2026-12-01')", [
        name,
        JSON.stringify(items),
        fee,
        rate,
      ]);
    await expect(create([])).rejects.toThrow(/check constraint/);
    await expect(create([{ id: "B1", text: "a" }, { id: "B1", text: "b" }])).rejects.toThrow(/check constraint/);
    await expect(create([{ id: "B1", text: "   " }])).rejects.toThrow(/check constraint/);
    await expect(create([{ id: "B1", text: "x".repeat(501) }])).rejects.toThrow(/check constraint/);
    await expect(create([{ id: "B1", text: "a", extra: 1 }])).rejects.toThrow(/check constraint/);
    await expect(create(Array.from({ length: 11 }, (_, i) => ({ id: `B${i}`, text: "a" })))).rejects.toThrow(/check constraint/);
    await expect(create([{ id: "B1", text: "a" }], -1)).rejects.toThrow(/check constraint/);
    await expect(create([{ id: "B1", text: "a" }], 100000001)).rejects.toThrow(/check constraint/);
    await expect(create([{ id: "B1", text: "a" }], 100, 0)).rejects.toThrow(/check constraint/);
    await expect(create([{ id: "B1", text: "a" }], 100, 100001)).rejects.toThrow(/check constraint/);
    await expect(create([{ id: "B1", text: "a" }], 100, 100, "x".repeat(101))).rejects.toThrow(/check constraint/);
    const [ok] = await db.asUser<{ id: string }>(
      a,
      "select public.create_project('P', 'C', $1::jsonb, 0, 1, '2026-12-01') as id",
      [JSON.stringify([{ id: "B1", text: "a" }])],
    );
    expect(ok.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("requires an authenticated identity", async () => {
    await expect(db.run("authenticated", null, "select public.seed_demo_project()")).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(db.run("anon", null, "select public.seed_demo_project()")).rejects.toThrow(/permission denied/);
  });
});

describe("row-level security and grants", () => {
  it("visitor B can neither read nor act on visitor A's records", async () => {
    const a = await db.newVisitor();
    const b = await db.newVisitor();
    const projectA = await seed(a);
    await seed(b);
    const v1 = await publish(a, projectA);
    await decide(v1.token, "accepted");
    await db.asUser(a, "select public.begin_analysis_run($1, $2)", [projectA, await sha256Hex("x")]);

    for (const table of ["projects", "change_versions", "decision_events", "analysis_runs"]) {
      const rows = await db.asUser<{ id: string }>(b, `select id from public.${table}`);
      expect(rows.some((r) => r.id === projectA || r.id === v1.versionId), table).toBe(false);
    }
    expect(await db.asUser(b, "select * from public.change_versions")).toHaveLength(0);
    expect(await db.asUser(b, "select * from public.decision_events")).toHaveLength(0);
    expect(await db.asUser(b, "select * from public.analysis_runs")).toHaveLength(0);
    expect(await db.asUser(b, "select id from public.review_tokens")).toHaveLength(0);
    expect(await db.asUser(b, "select * from public.projects where id = $1", [projectA])).toHaveLength(0);

    await expect(publish(b, projectA)).rejects.toThrow(/NOT_FOUND/);
    await expect(
      db.asUser(b, "select public.begin_analysis_run($1, $2)", [projectA, await sha256Hex("x")]),
    ).rejects.toThrow(/NOT_FOUND/);

    // Owner still sees their own data.
    expect(await db.asUser(a, "select id from public.change_versions")).toHaveLength(1);
    expect(await db.asUser(a, "select id from public.decision_events")).toHaveLength(1);
  });

  it("denies direct writes, hash reads and anon reads by default", async () => {
    const a = await db.newVisitor();
    const projectA = await seed(a);
    await publish(a, projectA);
    await expect(db.asUser(a, "update public.projects set name = 'x'")).rejects.toThrow(/permission denied/);
    await expect(db.asUser(a, "delete from public.change_versions")).rejects.toThrow(/permission denied/);
    await expect(
      db.asUser(a, "insert into public.decision_events (change_version_id, review_token_id, decision, declared_name) values (gen_random_uuid(), gen_random_uuid(), 'accepted', 'x')"),
    ).rejects.toThrow(/permission denied/);
    await expect(db.asUser(a, "select token_hash from public.review_tokens")).rejects.toThrow(/permission denied/);
    expect(await db.asUser(a, "select id, expires_at from public.review_tokens")).toHaveLength(1);
    await expect(db.run("anon", null, "select * from public.projects")).rejects.toThrow(/permission denied/);
  });

  it("restricts review routines to the service role", async () => {
    const a = await db.newVisitor();
    await expect(db.asUser(a, "select public.get_review_snapshot($1)", ["0".repeat(64)])).rejects.toThrow(/permission denied/);
    await expect(
      db.asUser(a, "select public.record_review_decision($1, 'accepted', 'x', null)", ["0".repeat(64)]),
    ).rejects.toThrow(/permission denied/);
    await expect(db.run("anon", null, "select public.get_review_snapshot($1)", ["0".repeat(64)])).rejects.toThrow(/permission denied/);
  });
});

describe("publication", () => {
  it("computes the fee in the database and publishes version 1 atomically", async () => {
    const a = await db.newVisitor();
    const projectId = await seed(a);
    const v1 = await publish(a, projectId);
    expect(v1).toMatchObject({ versionNumber: 1, extraFeePence: 13500, revisedTotalPence: 193500, created: true });
    const [p] = await db.asUser<{ current_version_id: string }>(a, "select current_version_id from public.projects");
    expect(p.current_version_id).toBe(v1.versionId);
    const [v] = await db.asUser<Record<string, unknown>>(a, "select * from public.change_versions");
    expect(v.baseline_snapshot).toEqual({
      projectName: "Northlight website refresh",
      clientName: "Northlight Studio",
      baselineItems: [
        { id: "B1", text: "Design and implement a three page responsive website" },
        { id: "B2", text: "Include one round of revisions" },
        { id: "B3", text: "Deliver the agreed pages by 2026-11-09" },
      ],
      originalFeePence: 180000,
      ratePence: 9000,
      dueOn: "2026-11-09",
      currency: "GBP",
    });
  });

  it("is idempotent per publish key and rotates the review link", async () => {
    const a = await db.newVisitor();
    const projectId = await seed(a);
    const key = randomUUID();
    const first = await publish(a, projectId, { key });
    const retry = await publish(a, projectId, { key, effort: 2400, due: "2027-01-01" });
    expect(retry.versionId).toBe(first.versionId);
    expect(retry).toMatchObject({ versionNumber: 1, created: false, extraFeePence: 13500 });
    expect(await db.asUser(a, "select id from public.change_versions")).toHaveLength(1);
    expect(await snapshot(first.token)).toBeNull();
    expect(await snapshot(retry.token)).not.toBeNull();
    const tokens = await db.asUser<{ revoked_at: string | null }>(a, "select revoked_at from public.review_tokens");
    expect(tokens.filter((t) => t.revoked_at === null)).toHaveLength(1);
  });

  it("serialises parallel publishes without duplicate numbers", async () => {
    const a = await db.newVisitor();
    const projectId = await seed(a);
    const key = randomUUID();
    const results = await Promise.allSettled([
      publish(a, projectId, { key }),
      publish(a, projectId, { key }),
      publish(a, projectId, { key: randomUUID() }), // stale: expected null but v1 exists by then
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(2);
    expect(results[2]).toMatchObject({ status: "rejected" });
    expect(String((results[2] as PromiseRejectedResult).reason)).toMatch(/STALE_VERSION/);
    expect(await db.asUser(a, "select id from public.change_versions")).toHaveLength(1);
  });

  it("rejects stale expectations, invalid effort, dates and items", async () => {
    const a = await db.newVisitor();
    const projectId = await seed(a);
    for (const effort of [0, -15, 16, 17, 89, 2415]) {
      await expect(publish(a, projectId, { effort })).rejects.toThrow(/INVALID_EFFORT/);
    }
    await expect(publish(a, projectId, { due: "2026-11-08" })).rejects.toThrow(/INVALID_DUE_DATE/);
    await expect(publish(a, projectId, { items: [] })).rejects.toThrow(/INVALID_APPROVED_ITEMS/);
    await expect(
      publish(a, projectId, { items: [{ ...ITEMS[0], baselineItemIds: ["B9"] }] }),
    ).rejects.toThrow(/INVALID_APPROVED_ITEMS/);
    await expect(
      publish(a, projectId, { items: Array.from({ length: 11 }, (_, i) => ({ ...ITEMS[0], id: `c${i}` })) }),
    ).rejects.toThrow(/INVALID_APPROVED_ITEMS/);
    await expect(
      publish(a, projectId, { items: [{ ...ITEMS[0], origin: "manually_entered" }] }),
    ).rejects.toThrow(/INVALID_APPROVED_ITEMS/);
    await expect(publish(a, projectId, { items: [{ ...ITEMS[0], extraFeePence: 1 }] })).rejects.toThrow(
      /INVALID_APPROVED_ITEMS/,
    );
    const k1 = randomUUID();
    const v1 = await publish(a, projectId, { key: k1 });
    await expect(publish(a, projectId, { expected: null })).rejects.toThrow(/STALE_VERSION/);
    const v2 = await publish(a, projectId, { expected: v1.versionId, effort: 120 });
    expect(v2).toMatchObject({ versionNumber: 2, extraFeePence: 18000, revisedTotalPence: 198000 });
    // Retrying v1's key after v2 exists must not resurrect v1's link.
    await expect(publish(a, projectId, { key: k1, expected: v1.versionId })).rejects.toThrow(/STALE_VERSION/);
  });

  it("never lets anyone mutate published records or baselines", async () => {
    const a = await db.newVisitor();
    const projectId = await seed(a);
    const v1 = await publish(a, projectId);
    await decide(v1.token, "accepted");
    await expect(db.admin("update public.change_versions set effort_minutes = 15")).rejects.toThrow(/IMMUTABLE_RECORD/);
    await expect(db.admin("delete from public.change_versions")).rejects.toThrow(/IMMUTABLE_RECORD/);
    await expect(db.admin("update public.decision_events set decision = 'revision_requested'")).rejects.toThrow(/IMMUTABLE_RECORD/);
    await expect(db.admin("delete from public.decision_events")).rejects.toThrow(/IMMUTABLE_RECORD/);
    await expect(db.admin("update public.projects set rate_pence = 1")).rejects.toThrow(/BASELINE_IMMUTABLE/);
    await expect(db.admin("update public.projects set baseline_items = '[]'")).rejects.toThrow(/BASELINE_IMMUTABLE/);
    await expect(db.admin("update public.review_tokens set expires_at = now() + interval '1 year'")).rejects.toThrow(/IMMUTABLE_RECORD/);
    await expect(db.admin("delete from public.review_tokens")).rejects.toThrow(/IMMUTABLE_RECORD/);
  });
});

describe("client review and decisions", () => {
  it("exposes only the allowlisted snapshot to a valid bearer", async () => {
    const a = await db.newVisitor();
    const v1 = await publish(a, await seed(a));
    const s = await snapshot(v1.token);
    expect(Object.keys(s!).sort()).toEqual(
      [
        "approvedItems", "baselineItems", "clientName", "decision", "effortMinutes", "extraFeePence",
        "linkExpiresAt", "originalDueOn", "originalFeePence", "projectName", "publishedAt", "ratePence",
        "revisedDueOn", "revisedTotalPence", "versionNumber",
      ].sort(),
    );
    expect(s).toMatchObject({ versionNumber: 1, extraFeePence: 13500, revisedTotalPence: 193500, revisedDueOn: "2026-11-11", decision: null });
    expect(s!.approvedItems).toEqual([
      { description: "Add two service pages", baselineItemIds: ["B1"] },
      { description: "Second round of revisions", baselineItemIds: ["B2"] },
    ]);
    const serialised = JSON.stringify(s);
    expect(serialised).not.toContain(a);
    expect(serialised).not.toContain(v1.versionId);
    expect(serialised).not.toContain(NORTHLIGHT_REQUEST);
  });

  it("records one terminal decision; replay is idempotent; opposite conflicts", async () => {
    const a = await db.newVisitor();
    const v1 = await publish(a, await seed(a));
    expect(await decide(v1.token, "accepted")).toMatchObject({ status: "created", decision: "accepted", declaredName: "Demo Client" });
    expect(await decide(v1.token, "accepted", "  Demo Client ")).toMatchObject({ status: "replayed" });
    await expect(decide(v1.token, "revision_requested")).rejects.toThrow(/DECISION_CONFLICT/);
    await expect(decide(v1.token, "accepted", "Someone else")).rejects.toThrow(/DECISION_CONFLICT/);
    expect(await db.asUser(a, "select id from public.decision_events")).toHaveLength(1);
    expect((await snapshot(v1.token))!.decision).toMatchObject({ decision: "accepted", declaredName: "Demo Client" });
  });

  it("simultaneous opposite decisions yield exactly one event and one conflict", async () => {
    const a = await db.newVisitor();
    const v1 = await publish(a, await seed(a));
    const results = await Promise.allSettled([decide(v1.token, "accepted"), decide(v1.token, "revision_requested")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason)).toMatch(/DECISION_CONFLICT/);
    expect(await db.asUser(a, "select id from public.decision_events")).toHaveLength(1);
  });

  it("validates reviewer input", async () => {
    const a = await db.newVisitor();
    const v1 = await publish(a, await seed(a));
    await expect(decide(v1.token, "approved")).rejects.toThrow(/VALIDATION_FAILED/);
    await expect(decide(v1.token, "accepted", "   ")).rejects.toThrow(/VALIDATION_FAILED/);
    await expect(decide(v1.token, "accepted", "x".repeat(101))).rejects.toThrow(/VALIDATION_FAILED/);
    await expect(decide(v1.token, "accepted", "Demo Client", "n".repeat(1001))).rejects.toThrow(/VALIDATION_FAILED/);
  });

  it("superseded, revoked, expired and unknown tokens are uniformly unavailable", async () => {
    const a = await db.newVisitor();
    const projectId = await seed(a);
    const v1 = await publish(a, projectId);
    await decide(v1.token, "accepted");
    const v2 = await publish(a, projectId, { expected: v1.versionId, effort: 120 });

    expect(await snapshot(v1.token)).toBeNull();
    await expect(decide(v1.token, "accepted")).rejects.toThrow(/UNAVAILABLE/);
    expect(await snapshot("never-issued")).toBeNull();
    await expect(decide("never-issued", "accepted")).rejects.toThrow(/UNAVAILABLE/);
    expect(await db.asService<{ s: unknown }>("select public.get_review_snapshot('not-a-hash') as s")).toEqual([{ s: null }]);

    // Version 2 link works; version 1's accepted record is untouched.
    expect(await snapshot(v2.token)).toMatchObject({ versionNumber: 2, extraFeePence: 18000, decision: null });
    const [old] = await db.asUser<Record<string, unknown>>(
      a,
      "select v.extra_fee_pence, v.revised_total_pence, d.decision from public.change_versions v join public.decision_events d on d.change_version_id = v.id where v.version_number = 1",
    );
    expect(old).toEqual({ extra_fee_pence: 13500, revised_total_pence: 193500, decision: "accepted" });

    // Expire v2's link (test setup bypasses the revoke-only trigger).
    await db.admin("alter table public.review_tokens disable trigger review_tokens_revoke_only");
    await db.admin(
      "update public.review_tokens set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where revoked_at is null",
    );
    await db.admin("alter table public.review_tokens enable trigger review_tokens_revoke_only");
    expect(await snapshot(v2.token)).toBeNull();
    await expect(decide(v2.token, "accepted")).rejects.toThrow(/UNAVAILABLE/);
  });
});

describe("analysis rate limiting", () => {
  it("allows 3 analyses per minute and 20 per day from shared state", async () => {
    const a = await db.newVisitor();
    const projectId = await seed(a);
    const hash = await sha256Hex(NORTHLIGHT_REQUEST);
    const begin = () => db.asUser<{ id: string }>(a, "select public.begin_analysis_run($1, $2) as id", [projectId, hash]);
    for (let i = 0; i < 3; i++) await begin();
    await expect(begin()).rejects.toThrow(/RATE_LIMITED_MINUTE/);

    await db.admin("alter table public.analysis_runs disable trigger analysis_runs_complete_once");
    await db.admin("update public.analysis_runs set created_at = now() - interval '2 minutes'");
    for (let i = 0; i < 17; i++) {
      await db.admin(
        "insert into public.analysis_runs (project_id, user_id, source_request_hash, created_at) values ($1, $2, $3, now() - interval '1 hour')",
        [projectId, a, hash],
      );
    }
    await db.admin("alter table public.analysis_runs enable trigger analysis_runs_complete_once");
    await expect(begin()).rejects.toThrow(/RATE_LIMITED_DAY/);

    // Another visitor has their own allowance.
    const b = await db.newVisitor();
    const projectB = await seed(b);
    await db.asUser(b, "select public.begin_analysis_run($1, $2)", [projectB, hash]);
  });

  it("completes a run exactly once and records usage", async () => {
    const a = await db.newVisitor();
    const projectId = await seed(a);
    const [{ id }] = await db.asUser<{ id: string }>(a, "select public.begin_analysis_run($1, $2) as id", [
      projectId,
      await sha256Hex("r"),
    ]);
    const complete = () =>
      db.asUser(a, "select public.complete_analysis_run($1, 'success', '{\"items\":[]}'::jsonb, 'm', '{\"input_tokens\":1}'::jsonb, null, 1)", [id]);
    await complete();
    await expect(complete()).rejects.toThrow(/NOT_FOUND/);
    const [run] = await db.asUser<Record<string, unknown>>(a, "select status, model_id, token_usage from public.analysis_runs");
    expect(run).toEqual({ status: "success", model_id: "m", token_usage: { input_tokens: 1 } });
  });
});
