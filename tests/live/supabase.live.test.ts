import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

/**
 * LIVE CHECK against the real Supabase project with both migrations applied.
 * Run with `npm run test:live` (reads .env / .env.local). Creates throwaway
 * visitors and demo rows in that project.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const enabled = Boolean(url && serviceKey);

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const ITEMS = [
  { id: "c1", description: "Add two service pages", baselineItemIds: ["B1"], origin: "ai_suggested", sourceQuote: "add two service pages", classification: "potential_addition" },
];

const admin = () => createClient(url!, serviceKey!, opts);

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

const visitor = () => rpc<string>("resolve_visitor", { p_secret_hash: randomBytes(32).toString("hex"), p_create: true });

async function publish(visitorId: string, projectId: string, expected: string | null, effort = 90, key = randomUUID()) {
  const token = randomBytes(32).toString("base64url");
  const res = await admin().rpc("publish_change_version", {
    p_visitor_id: visitorId,
    p_project_id: projectId,
    p_publish_key: key,
    p_expected_current_version_id: expected,
    p_request_text: "Please add two service pages and a second round of revisions.",
    p_approved_items: ITEMS,
    p_effort_minutes: effort,
    p_revised_due_on: "2026-11-11",
    p_token_hash: hash(token),
  });
  return { ...res, token };
}

describe.skipIf(!enabled)("live Supabase: isolation, privileges and real concurrency", () => {
  it("two visitors are isolated by the owner routines", async () => {
    const a = await visitor();
    const b = await visitor();
    const projectA = await rpc<string>("seed_demo_project", { p_visitor_id: a });
    await rpc("seed_demo_project", { p_visitor_id: b });
    const v1 = await publish(a, projectA, null);
    expect(v1.error).toBeNull();
    expect(v1.data).toMatchObject({ versionNumber: 1, extraFeePence: 13500, revisedTotalPence: 193500 });

    expect(await rpc("owner_get_project", { p_visitor_id: b, p_project_id: projectA })).toBeNull();
    expect(await rpc("owner_list_versions", { p_visitor_id: b, p_project_id: projectA })).toEqual([]);
    expect(JSON.stringify(await rpc("owner_list_projects", { p_visitor_id: b }))).not.toContain(projectA);
    expect((await publish(b, projectA, null)).error?.message).toBe("NOT_FOUND");
    expect(await rpc("owner_get_project", { p_visitor_id: a, p_project_id: projectA })).not.toBeNull();
  });

  it.skipIf(!publishableKey)("the publishable key can reach no table or routine", async () => {
    const pub = createClient(url!, publishableKey!, opts);
    for (const table of ["visitors", "projects", "change_versions", "review_tokens", "decision_events", "analysis_runs"]) {
      const { data, error } = await pub.from(table).select("*").limit(1);
      expect(error !== null || (data ?? []).length === 0, table).toBe(true);
    }
    for (const [fn, args] of [
      ["resolve_visitor", { p_secret_hash: "0".repeat(64), p_create: true }],
      ["owner_list_projects", { p_visitor_id: randomUUID() }],
      ["get_review_snapshot", { p_token_hash: "0".repeat(64) }],
    ] as const) {
      const { error } = await pub.rpc(fn, args);
      expect(error, fn).not.toBeNull();
    }
  });

  it("parallel opposite decisions over separate connections create exactly one event", async () => {
    const a = await visitor();
    const projectId = await rpc<string>("seed_demo_project", { p_visitor_id: a });
    const v1 = await publish(a, projectId, null);
    const results = await Promise.all(
      ["accepted", "revision_requested", "accepted", "revision_requested"].map((d) =>
        admin().rpc("record_review_decision", { p_token_hash: hash(v1.token), p_decision: d, p_declared_name: "Demo Client", p_note: null }),
      ),
    );
    expect(results.filter((r) => r.data?.status === "created")).toHaveLength(1);
    for (const r of results.filter((r) => r.error)) expect(r.error!.message).toBe("DECISION_CONFLICT");
    expect(await rpc("owner_list_decisions", { p_visitor_id: a, p_project_id: projectId })).toHaveLength(1);
  });

  it("parallel publishes allocate no duplicate version numbers", async () => {
    const a = await visitor();
    const projectId = await rpc<string>("seed_demo_project", { p_visitor_id: a });
    const key = randomUUID();
    const results = await Promise.all([
      publish(a, projectId, null, 90, key),
      publish(a, projectId, null, 90, key),
      publish(a, projectId, null, 120),
      publish(a, projectId, null, 120),
    ]);
    expect(await rpc("owner_list_versions", { p_visitor_id: a, p_project_id: projectId })).toHaveLength(1);
    expect(await rpc("owner_get_active_link", { p_visitor_id: a, p_project_id: projectId })).not.toBeNull();
    expect(results.filter((r) => r.error).every((r) => r.error!.message === "STALE_VERSION")).toBe(true);
  });
});
