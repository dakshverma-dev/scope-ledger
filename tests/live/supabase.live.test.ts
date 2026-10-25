import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

/**
 * LIVE CHECK against a real Supabase project with the migration applied and
 * anonymous sign-ins enabled. Run with `npm run test:live` (reads .env.local).
 * Creates two throwaway anonymous users and demo rows in that project.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anonKey && serviceKey);

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const ITEMS = [
  { id: "c1", description: "Add two service pages", baselineItemIds: ["B1"], origin: "ai_suggested", sourceQuote: "add two service pages", classification: "potential_addition" },
];

async function visitor(): Promise<SupabaseClient> {
  const c = createClient(url!, anonKey!, opts);
  const { error } = await c.auth.signInAnonymously();
  if (error) throw error;
  return c;
}

async function publish(c: SupabaseClient, projectId: string, expected: string | null, effort = 90, key = randomUUID()) {
  const token = randomBytes(32).toString("base64url");
  const res = await c.rpc("publish_change_version", {
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

describe.skipIf(!enabled)("live Supabase: isolation, grants and real concurrency", () => {
  it("two anonymous visitors are isolated by RLS and grants", async () => {
    const a = await visitor();
    const b = await visitor();
    const { data: projectA, error: seedErr } = await a.rpc("seed_demo_project");
    expect(seedErr).toBeNull();
    await b.rpc("seed_demo_project");
    const v1 = await publish(a, projectA as string, null);
    expect(v1.error).toBeNull();
    expect(v1.data).toMatchObject({ versionNumber: 1, extraFeePence: 13500, revisedTotalPence: 193500 });

    const { data: bProjects } = await b.from("projects").select("id");
    expect(bProjects!.map((p) => p.id)).not.toContain(projectA);
    expect((await b.from("change_versions").select("id").eq("project_id", projectA)).data).toEqual([]);
    expect((await b.from("analysis_runs").select("id").eq("project_id", projectA)).data).toEqual([]);
    expect((await b.from("review_tokens").select("id").eq("project_id", projectA)).data).toEqual([]);
    expect((await publish(b, projectA as string, null)).error?.message).toBe("NOT_FOUND");

    // Direct writes and hash reads are denied even for the owner.
    expect((await a.from("projects").update({ name: "x" }).eq("id", projectA)).error).not.toBeNull();
    expect((await a.from("review_tokens").select("token_hash")).error).not.toBeNull();
    expect((await a.rpc("get_review_snapshot", { p_token_hash: hash(v1.token) })).error).not.toBeNull();

    // A client with no session sees nothing.
    const nobody = createClient(url!, anonKey!, opts);
    const anonRead = await nobody.from("projects").select("id");
    expect(anonRead.data ?? []).toEqual([]);
  });

  it("parallel opposite decisions over separate connections create exactly one event", async () => {
    const a = await visitor();
    const { data: projectId } = await a.rpc("seed_demo_project");
    const v1 = await publish(a, projectId as string, null);
    const admin = createClient(url!, serviceKey!, opts);
    const results = await Promise.all(
      ["accepted", "revision_requested", "accepted", "revision_requested"].map((d) =>
        admin.rpc("record_review_decision", { p_token_hash: hash(v1.token), p_decision: d, p_declared_name: "Demo Client", p_note: null }),
      ),
    );
    const created = results.filter((r) => r.data?.status === "created");
    expect(created).toHaveLength(1);
    for (const r of results.filter((r) => r.error)) expect(r.error!.message).toBe("DECISION_CONFLICT");
    const { data: events } = await a.from("decision_events").select("id");
    expect(events).toHaveLength(1);
  });

  it("parallel publishes allocate no duplicate version numbers", async () => {
    const a = await visitor();
    const { data: projectId } = await a.rpc("seed_demo_project");
    const key = randomUUID();
    const results = await Promise.all([
      publish(a, projectId as string, null, 90, key),
      publish(a, projectId as string, null, 90, key),
      publish(a, projectId as string, null, 120),
      publish(a, projectId as string, null, 120),
    ]);
    const { data: versions } = await a.from("change_versions").select("version_number").eq("project_id", projectId);
    expect(versions).toHaveLength(1);
    const { data: active } = await a.from("review_tokens").select("id").eq("project_id", projectId).is("revoked_at", null);
    expect(active).toHaveLength(1);
    expect(results.filter((r) => r.error).every((r) => r.error!.message === "STALE_VERSION")).toBe(true);
  });
});
