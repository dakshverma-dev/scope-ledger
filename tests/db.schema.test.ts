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

type Row = Record<string, unknown>;
const one = async (sql: string, params: unknown[]) => (await db.asService<{ v: unknown }>(sql, params))[0].v;

const seed = async (visitor: string) => String(await one("select public.seed_demo_project($1) as v", [visitor]));
const getProject = (visitor: string, id: string) => one("select public.owner_get_project($1, $2) as v", [visitor, id]) as Promise<Row | null>;
const listVersions = (visitor: string, id: string) => one("select public.owner_list_versions($1, $2) as v", [visitor, id]) as Promise<Row[]>;
const listDecisions = (visitor: string, id: string) => one("select public.owner_list_decisions($1, $2) as v", [visitor, id]) as Promise<Row[]>;

async function publish(
  visitor: string,
  projectId: string,
  opts: { key?: string; expected?: string | null; effort?: number; due?: string; items?: unknown; token?: string } = {},
) {
  const token = opts.token ?? randomUUID();
  const r = (await one("select public.publish_change_version($1, $2, $3, $4, $5, $6::jsonb, $7, $8::date, $9) as v", [
    visitor,
    projectId,
    opts.key ?? randomUUID(),
    opts.expected ?? null,
    NORTHLIGHT_REQUEST,
    JSON.stringify(opts.items ?? ITEMS),
    opts.effort ?? 90,
    opts.due ?? "2026-11-11",
    await sha256Hex(token),
  ])) as { versionId: string; versionNumber: number; extraFeePence: number; revisedTotalPence: number; created: boolean };
  return { ...r, token };
}

const snapshot = async (token: string) =>
  (await one("select public.get_review_snapshot($1) as v", [await sha256Hex(token)])) as Row | null;

const decide = async (token: string, decision: string, name = "Demo Client", note: string | null = null) =>
  (await one("select public.record_review_decision($1, $2, $3, $4) as v", [await sha256Hex(token), decision, name, note])) as Row;

describe("visitor identity", () => {
  it("resolves a cookie secret hash to one stable visitor", async () => {
    const hash = await sha256Hex("cookie-secret");
    expect(await one("select public.resolve_visitor($1, false) as v", [hash])).toBeNull();
    const id = await one("select public.resolve_visitor($1, true) as v", [hash]);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await one("select public.resolve_visitor($1, true) as v", [hash])).toBe(id);
    expect(await one("select public.resolve_visitor($1, false) as v", [hash])).toBe(id);
    expect(await one("select public.resolve_visitor($1, true) as v", ["not-a-hash"])).toBeNull();
    expect(JSON.stringify(await db.admin("select * from public.visitors"))).not.toContain("cookie-secret");
  });

  it("rejects unknown or missing visitors", async () => {
    await expect(seed(randomUUID())).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(db.asService("select public.seed_demo_project(null)")).rejects.toThrow(/UNAUTHENTICATED/);
  });
});

describe("projects, demo seed and free allowance", () => {
  it("seeds Northlight idempotently per visitor with the exact fixture", async () => {
    const a = await db.newVisitor();
    const first = await seed(a);
    expect(await seed(a)).toBe(first);
    const p = await getProject(a, first);
    expect(p).toMatchObject({
      name: "Northlight website refresh",
      client_name: "Northlight Studio",
      original_fee_pence: 180000,
      rate_pence: 9000,
      due_on: "2026-11-09",
      current_version_id: null,
    });
    expect(p!.baseline_items).toEqual([
      { id: "B1", text: "Design and implement a three page responsive website" },
      { id: "B2", text: "Include one round of revisions" },
      { id: "B3", text: "Deliver the agreed pages by 2026-11-09" },
    ]);
    expect(p).not.toHaveProperty("user_id");
  });

  it("gives each visitor an isolated copy of the demo", async () => {
    const a = await db.newVisitor();
    const b = await db.newVisitor();
    expect(await seed(a)).not.toBe(await seed(b));
    expect(await one("select public.owner_list_projects($1) as v", [a])).toHaveLength(1);
    expect(await one("select public.owner_list_projects($1) as v", [b])).toHaveLength(1);
  });

  it("enforces one active project on the free allowance", async () => {
    const a = await db.newVisitor();
    await seed(a);
    await expect(
      db.asService("select public.create_project($1, 'Second', 'Client', $2::jsonb, 100, 100, '2026-12-01')", [
        a,
        JSON.stringify([{ id: "B1", text: "Thing" }]),
      ]),
    ).rejects.toThrow(/FREE_LIMIT_REACHED/);
  });

  it("validates baseline shape and money ranges in the database", async () => {
    const a = await db.newVisitor();
    const create = (items: unknown, fee = 100, rate = 100, name = "P") =>
      db.asService("select public.create_project($1, $2, 'Client', $3::jsonb, $4, $5, '2026-12-01')", [
        a,
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
    const [ok] = await db.asService<{ id: string }>(
      "select public.create_project($1, 'P', 'C', $2::jsonb, 0, 1, '2026-12-01') as id",
      [a, JSON.stringify([{ id: "B1", text: "a" }])],
    );
    expect(ok.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("ownership and privileges", () => {
  it("visitor B can neither read nor act on visitor A's records", async () => {
    const a = await db.newVisitor();
    const b = await db.newVisitor();
    const projectA = await seed(a);
    await seed(b);
    const v1 = await publish(a, projectA);
    await decide(v1.token, "accepted");
    await db.asService("select public.begin_analysis_run($1, $2, $3)", [a, projectA, await sha256Hex("x")]);

    expect(await getProject(b, projectA)).toBeNull();
    expect(await listVersions(b, projectA)).toEqual([]);
    expect(await listDecisions(b, projectA)).toEqual([]);
    expect(await one("select public.owner_get_version($1, $2) as v", [b, v1.versionId])).toBeNull();
    expect(await one("select public.owner_get_active_link($1, $2) as v", [b, projectA])).toBeNull();
    expect(JSON.stringify(await one("select public.owner_list_projects($1) as v", [b]))).not.toContain(projectA);
    await expect(publish(b, projectA)).rejects.toThrow(/NOT_FOUND/);
    await expect(
      db.asService("select public.begin_analysis_run($1, $2, $3)", [b, projectA, await sha256Hex("x")]),
    ).rejects.toThrow(/NOT_FOUND/);
    const run = (await db.admin<{ id: string }>("select id from public.analysis_runs"))[0].id;
    await expect(
      db.asService("select public.complete_analysis_run($1, $2, 'success', null, 'm', null, null, 1)", [b, run]),
    ).rejects.toThrow(/NOT_FOUND/);

    // Owner still sees their own data.
    expect(await listVersions(a, projectA)).toHaveLength(1);
    expect(await listDecisions(a, projectA)).toHaveLength(1);
  });

  it("API roles (anon, authenticated) can reach no table and no routine", async () => {
    const a = await db.newVisitor();
    const projectA = await seed(a);
    const v1 = await publish(a, projectA);
    for (const role of ["anon", "authenticated"] as const) {
      for (const table of ["visitors", "projects", "change_versions", "review_tokens", "decision_events", "analysis_runs"]) {
        await expect(db.run(role, a, `select * from public.${table}`), `${role} ${table}`).rejects.toThrow(/permission denied/);
      }
      for (const call of [
        "select public.resolve_visitor(repeat('0', 64), true)",
        `select public.owner_list_projects('${a}')`,
        `select public.owner_get_project('${a}', '${projectA}')`,
        `select public.seed_demo_project('${a}')`,
        `select public.get_review_snapshot('${await sha256Hex(v1.token)}')`,
        `select public.record_review_decision('${await sha256Hex(v1.token)}', 'accepted', 'x', null)`,
      ]) {
        await expect(db.run(role, a, call), `${role} ${call}`).rejects.toThrow(/permission denied/);
      }
    }
  });

  it("never returns the review token hash to the owner", async () => {
    const a = await db.newVisitor();
    const projectA = await seed(a);
    const v1 = await publish(a, projectA);
    const link = await one("select public.owner_get_active_link($1, $2) as v", [a, projectA]);
    expect(Object.keys(link as Row).sort()).toEqual(["change_version_id", "created_at", "expires_at"]);
    expect(JSON.stringify(link)).not.toContain(await sha256Hex(v1.token));
  });
});

describe("publication", () => {
  it("computes the fee in the database and publishes version 1 atomically", async () => {
    const a = await db.newVisitor();
    const projectId = await seed(a);
    const v1 = await publish(a, projectId);
    expect(v1).toMatchObject({ versionNumber: 1, extraFeePence: 13500, revisedTotalPence: 193500, created: true });
    expect((await getProject(a, projectId))!.current_version_id).toBe(v1.versionId);
    const [v] = await listVersions(a, projectId);
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
    expect(await listVersions(a, projectId)).toHaveLength(1);
    expect(await snapshot(first.token)).toBeNull();
    expect(await snapshot(retry.token)).not.toBeNull();
    const tokens = await db.admin<{ revoked_at: string | null }>("select revoked_at from public.review_tokens");
    expect(tokens.filter((t) => t.revoked_at === null)).toHaveLength(1);
  });

  it("serialises interleaved publishes without duplicate numbers", async () => {
    const a = await db.newVisitor();
    const projectId = await seed(a);
    const key = randomUUID();
    const results = await Promise.allSettled([
      publish(a, projectId, { key }),
      publish(a, projectId, { key }),
      publish(a, projectId, { key: randomUUID() }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(String((results[2] as PromiseRejectedResult).reason)).toMatch(/STALE_VERSION/);
    expect(await listVersions(a, projectId)).toHaveLength(1);
  });

  it("rejects stale expectations, invalid effort, dates and items", async () => {
    const a = await db.newVisitor();
    const projectId = await seed(a);
    for (const effort of [0, -15, 16, 17, 89, 2415]) {
      await expect(publish(a, projectId, { effort })).rejects.toThrow(/INVALID_EFFORT/);
    }
    await expect(publish(a, projectId, { due: "2026-11-08" })).rejects.toThrow(/INVALID_DUE_DATE/);
    await expect(publish(a, projectId, { items: [] })).rejects.toThrow(/INVALID_APPROVED_ITEMS/);
    await expect(publish(a, projectId, { items: [{ ...ITEMS[0], baselineItemIds: ["B9"] }] })).rejects.toThrow(/INVALID_APPROVED_ITEMS/);
    await expect(
      publish(a, projectId, { items: Array.from({ length: 11 }, (_, i) => ({ ...ITEMS[0], id: `c${i}` })) }),
    ).rejects.toThrow(/INVALID_APPROVED_ITEMS/);
    await expect(publish(a, projectId, { items: [{ ...ITEMS[0], origin: "manually_entered" }] })).rejects.toThrow(/INVALID_APPROVED_ITEMS/);
    await expect(publish(a, projectId, { items: [{ ...ITEMS[0], extraFeePence: 1 }] })).rejects.toThrow(/INVALID_APPROVED_ITEMS/);
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
    for (const sql of ["update public.change_versions set effort_minutes = 15", "delete from public.change_versions"]) {
      await expect(db.admin(sql)).rejects.toThrow(/IMMUTABLE_RECORD/);
      await expect(db.asService(sql)).rejects.toThrow(/IMMUTABLE_RECORD/);
    }
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
    const projectId = await seed(a);
    const v1 = await publish(a, projectId);
    expect(await decide(v1.token, "accepted")).toMatchObject({ status: "created", decision: "accepted", declaredName: "Demo Client" });
    expect(await decide(v1.token, "accepted", "  Demo Client ")).toMatchObject({ status: "replayed" });
    await expect(decide(v1.token, "revision_requested")).rejects.toThrow(/DECISION_CONFLICT/);
    await expect(decide(v1.token, "accepted", "Someone else")).rejects.toThrow(/DECISION_CONFLICT/);
    expect(await listDecisions(a, projectId)).toHaveLength(1);
    expect((await snapshot(v1.token))!.decision).toMatchObject({ decision: "accepted", declaredName: "Demo Client" });
  });

  it("interleaved opposite decisions yield exactly one event and one conflict", async () => {
    const a = await db.newVisitor();
    const projectId = await seed(a);
    const v1 = await publish(a, projectId);
    const results = await Promise.allSettled([decide(v1.token, "accepted"), decide(v1.token, "revision_requested")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(String(rejected[0].reason)).toMatch(/DECISION_CONFLICT/);
    expect(await listDecisions(a, projectId)).toHaveLength(1);
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
    expect(await one("select public.get_review_snapshot('not-a-hash') as v", [])).toBeNull();

    expect(await snapshot(v2.token)).toMatchObject({ versionNumber: 2, extraFeePence: 18000, decision: null });
    const [old] = await db.admin<Row>(
      "select v.extra_fee_pence, v.revised_total_pence, d.decision from public.change_versions v join public.decision_events d on d.change_version_id = v.id where v.version_number = 1",
    );
    expect(old).toEqual({ extra_fee_pence: 13500, revised_total_pence: 193500, decision: "accepted" });

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
    const begin = () => db.asService("select public.begin_analysis_run($1, $2, $3)", [a, projectId, hash]);
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

    const b = await db.newVisitor();
    const projectB = await seed(b);
    await db.asService("select public.begin_analysis_run($1, $2, $3)", [b, projectB, hash]);
  });

  it("completes a run exactly once and records usage", async () => {
    const a = await db.newVisitor();
    const projectId = await seed(a);
    const [{ id }] = await db.asService<{ id: string }>("select public.begin_analysis_run($1, $2, $3) as id", [
      a,
      projectId,
      await sha256Hex("r"),
    ]);
    const complete = () =>
      db.asService(
        "select public.complete_analysis_run($1, $2, 'success', '{\"items\":[]}'::jsonb, 'm', '{\"input_tokens\":1}'::jsonb, null, 1)",
        [a, id],
      );
    await complete();
    await expect(complete()).rejects.toThrow(/NOT_FOUND/);
    const [run] = await db.admin<Row>("select status, model_id, token_usage from public.analysis_runs");
    expect(run).toEqual({ status: "success", model_id: "m", token_usage: { input_tokens: 1 } });
  });
});
