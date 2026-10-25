import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractScopeChanges, SYSTEM_PROMPT, type CreateMessage } from "@/lib/ai/extract";
import { analyseByRules, RULES_MODEL_ID } from "@/lib/ai/rules-model";
import { TOOL_NAME, validateExtraction } from "@/lib/ai/schema";
import { analyseRequest } from "@/lib/services/analyse";
import { startDemo } from "@/lib/services/workspace";
import { createTestDb, pgliteRpc, type TestDb } from "./helpers/db";
import { NORTHLIGHT_REQUEST } from "./helpers/fixtures";
import { ownerRepository } from "@/lib/db/rpc-repository";

// TEST FIXTURES ONLY: fake model responses. No network call is made in this file.
const BASELINE = [
  { id: "B1", text: "Design and implement a three page responsive website" },
  { id: "B2", text: "Include one round of revisions" },
  { id: "B3", text: "Deliver the agreed pages by 2026-11-09" },
];
const GOOD = {
  items: [
    {
      requestedChange: "Add two service pages",
      sourceQuote: "add two service pages",
      baselineItemIds: ["B1"],
      classification: "potential_addition",
      reason: "B1 covers three pages; two more pages extend it.",
    },
    {
      requestedChange: "Add a second round of revisions",
      sourceQuote: "a second round of revisions",
      baselineItemIds: ["B2"],
      classification: "potential_addition",
      reason: "B2 includes one round of revisions only.",
    },
  ],
  missingInformation: [],
};

function message(input: unknown, name = TOOL_NAME, extra: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: "msg_fixture",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    stop_reason: "tool_use",
    stop_sequence: null,
    content: [{ type: "tool_use", id: "toolu_fixture", name, input }],
    usage: { input_tokens: 420, output_tokens: 160 },
    ...extra,
  } as unknown as Anthropic.Message;
}

const sequence = (...responses: (Anthropic.Message | Error)[]) => {
  const fn = vi.fn<CreateMessage>();
  for (const r of responses) fn.mockImplementationOnce(async () => (r instanceof Error ? Promise.reject(r) : r));
  return fn;
};

const run = (create: CreateMessage, deadlineMs?: number) =>
  extractScopeChanges({ create, modelId: "claude-haiku-5-5", baseline: BASELINE, requestText: NORTHLIGHT_REQUEST, deadlineMs });

describe("extract_scope_changes adapter", () => {
  it("returns the two Northlight candidates with literal quotes and real usage", async () => {
    const create = sequence(message(GOOD));
    const out = await run(create);
    expect(out).toMatchObject({ ok: true, attempts: 1, modelId: "claude-haiku-5-5", usage: { input_tokens: 420, output_tokens: 160 } });
    if (!out.ok) throw new Error("unreachable");
    expect(out.value.items.map((i) => [i.sourceQuote, i.baselineItemIds])).toEqual([
      ["add two service pages", ["B1"]],
      ["a second round of revisions", ["B2"]],
    ]);
    const [params, opts] = create.mock.calls[0];
    expect(params.model).toBe("claude-haiku-5-5");
    expect(params.system).toBe(SYSTEM_PROMPT);
    expect(params.tool_choice).toMatchObject({ type: "tool", name: "extract_scope_changes" });
    expect(params.tools?.[0]).toMatchObject({ name: "extract_scope_changes", strict: true });
    expect(JSON.stringify(params.messages)).toContain("<client_request>");
    expect(opts.maxRetries).toBe(0);
    expect(opts.timeout).toBeLessThanOrEqual(30000);
  });

  it("rejects an invented quote, repairs once, and accepts a valid repair", async () => {
    const bad = { ...GOOD, items: [{ ...GOOD.items[0], sourceQuote: "add three landing pages" }] };
    const create = sequence(message(bad), message(GOOD));
    const out = await run(create);
    expect(out).toMatchObject({ ok: true, attempts: 2, usage: { input_tokens: 840, output_tokens: 320 } });
    const repairMessages = create.mock.calls[1][0].messages;
    expect(repairMessages).toHaveLength(3);
    expect(JSON.stringify(repairMessages[2])).toContain("not an exact substring");
  });

  it("fails as INVALID_OUTPUT when the repair is also bad (max one repair)", async () => {
    const bad = { ...GOOD, items: [{ ...GOOD.items[0], baselineItemIds: ["B7"] }] };
    const create = sequence(message(bad), message(bad), message(GOOD));
    expect(await run(create)).toMatchObject({ ok: false, code: "INVALID_OUTPUT", attempts: 2 });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("rejects a wrong tool name, prose-only replies, unknown fields and bad classifications", async () => {
    expect(await run(sequence(message(GOOD, "other_tool"), message(GOOD, "other_tool")))).toMatchObject({ ok: false, code: "INVALID_OUTPUT" });
    const prose = { ...message(GOOD), content: [{ type: "text", text: "Here are the changes: ..." }] } as unknown as Anthropic.Message;
    expect(await run(sequence(prose, prose))).toMatchObject({ ok: false, code: "INVALID_OUTPUT" });
    expect(validateExtraction({ ...GOOD, verdict: "client owes money" }, ["B1", "B2", "B3"], NORTHLIGHT_REQUEST).ok).toBe(false);
    expect(
      validateExtraction({ ...GOOD, items: [{ ...GOOD.items[0], estimatedHours: 3 }] }, ["B1", "B2", "B3"], NORTHLIGHT_REQUEST).ok,
    ).toBe(false);
    expect(
      validateExtraction({ ...GOOD, items: [{ ...GOOD.items[0], classification: "billable" }] }, ["B1"], NORTHLIGHT_REQUEST).ok,
    ).toBe(false);
    expect(validateExtraction({ items: [] }, ["B1"], NORTHLIGHT_REQUEST).ok).toBe(false);
    const tooMany = { items: Array.from({ length: 11 }, () => GOOD.items[0]), missingInformation: [] };
    expect(validateExtraction(tooMany, ["B1", "B2"], NORTHLIGHT_REQUEST).ok).toBe(false);
  });

  it("accepts whitespace-only differences in quotes but not paraphrases", () => {
    const ws = { ...GOOD, items: [{ ...GOOD.items[0], sourceQuote: "add  two\nservice pages" }] };
    expect(validateExtraction(ws, ["B1", "B2", "B3"], NORTHLIGHT_REQUEST).ok).toBe(true);
    const para = { ...GOOD, items: [{ ...GOOD.items[0], sourceQuote: "add 2 service pages" }] };
    expect(validateExtraction(para, ["B1", "B2", "B3"], NORTHLIGHT_REQUEST).ok).toBe(false);
  });

  it("times out within the single overall deadline", async () => {
    const create = vi.fn<CreateMessage>(
      (_p, { signal }) =>
        new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Anthropic.APIUserAbortError()))),
    );
    const started = Date.now();
    expect(await run(create, 60)).toMatchObject({ ok: false, code: "TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("reports an unavailable model and upstream errors without retrying", async () => {
    const notFound = new Anthropic.NotFoundError(404, { type: "error", error: { type: "not_found_error", message: "model" } }, "model: claude-haiku-5-5", new Headers());
    expect(await run(sequence(notFound))).toMatchObject({ ok: false, code: "MODEL_UNAVAILABLE", attempts: 1 });
    const overloaded = new Anthropic.InternalServerError(529, { type: "error" }, "overloaded", new Headers());
    expect(await run(sequence(overloaded))).toMatchObject({ ok: false, code: "UPSTREAM_ERROR" });
    expect(await run(sequence(message(GOOD, TOOL_NAME, { stop_reason: "refusal" as Anthropic.StopReason })))).toMatchObject({ ok: false, code: "REFUSED" });
  });
});

describe("built-in rules extractor", () => {
  const ids = BASELINE.map((b) => b.id);

  it("flags uncertain or unmatched requests for judgment", () => {
    const out = analyseByRules(BASELINE, "Maybe we could also add a blog section?");
    expect(out.items).toHaveLength(1);
    expect(out.items[0].classification).toBe("unclear");
    expect(out.missingInformation.length).toBeGreaterThan(0);
    expect(validateExtraction(out, ids, "Maybe we could also add a blog section?").ok).toBe(true);
  });

  it("returns no items for a request without a concrete change", () => {
    const out = analyseByRules(BASELINE, "Thanks!");
    expect(out.items).toEqual([]);
    expect(out.missingInformation).toEqual(["No concrete change was found in the request."]);
  });

  it("always produces literal quotes and real baseline IDs", () => {
    for (const text of [
      "Could you add a contact page, plus extend the revisions to two rounds; and move the launch date.",
      "We'd like you to build a new pricing page.\nAlso please confirm whether B2 covers copy edits?",
      "  Add   three   more   landing pages  and   another feedback round  ",
      "Please make the website responsive on tablets as well as phones, and deliver it a week earlier.",
    ]) {
      expect(validateExtraction(analyseByRules(BASELINE, text), ids, text).ok, text).toBe(true);
    }
  });
});

describe("analyse service: limits, provenance and failures", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("stores a successful run with the actual model and usage, and flags judgment", async () => {
    const repo = ownerRepository(pgliteRpc(db), await db.newVisitor());
    const projectId = await startDemo(repo);
    const unclear = { items: [{ ...GOOD.items[0], classification: "unclear" }], missingInformation: ["Which services?"] };
    const res = await analyseRequest(repo, projectId, NORTHLIGHT_REQUEST, { create: sequence(message(unclear)), modelId: "claude-haiku-5-5" });
    expect(res).toMatchObject({ needsJudgment: true, modelId: "claude-haiku-5-5", missingInformation: ["Which services?"] });
    const [row] = await db.admin<Record<string, unknown>>("select status, model_id, token_usage, attempts, validated_result from public.analysis_runs");
    expect(row).toMatchObject({ status: "success", model_id: "claude-haiku-5-5", token_usage: { input_tokens: 420, output_tokens: 160 }, attempts: 1 });
    expect(JSON.stringify(row.validated_result)).not.toMatch(/thinking|reasoning/);
  });

  it("returns 503 on invalid output, records the failure and stores no items", async () => {
    const repo = ownerRepository(pgliteRpc(db), await db.newVisitor());
    const projectId = await startDemo(repo);
    const bad = { ...GOOD, items: [{ ...GOOD.items[0], sourceQuote: "fabricated" }] };
    await expect(
      analyseRequest(repo, projectId, NORTHLIGHT_REQUEST, { create: sequence(message(bad), message(bad)), modelId: "claude-haiku-5-5" }),
    ).rejects.toMatchObject({ code: "ANALYSIS_UNAVAILABLE", status: 503 });
    const [row] = await db.admin<Record<string, unknown>>("select status, failure_code, validated_result, attempts from public.analysis_runs");
    expect(row).toEqual({ status: "failure", failure_code: "INVALID_OUTPUT", validated_result: null, attempts: 2 });
    expect(await db.admin("select id from public.change_versions")).toHaveLength(0);
  });

  it("enforces 3 per minute from the database before calling the model", async () => {
    const repo = ownerRepository(pgliteRpc(db), await db.newVisitor());
    const projectId = await startDemo(repo);
    const create = vi.fn<CreateMessage>(async () => message(GOOD));
    for (let i = 0; i < 3; i++) await analyseRequest(repo, projectId, NORTHLIGHT_REQUEST, { create, modelId: "claude-haiku-5-5" });
    await expect(analyseRequest(repo, projectId, NORTHLIGHT_REQUEST, { create, modelId: "claude-haiku-5-5" })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
    });
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("uses the built-in extractor when no hosted model is configured, through the same validation", async () => {
    const repo = ownerRepository(pgliteRpc(db), await db.newVisitor());
    const projectId = await startDemo(repo);
    const res = await analyseRequest(repo, projectId, NORTHLIGHT_REQUEST, null);
    expect(res.items.map((i) => [i.sourceQuote, i.baselineItemIds, i.classification])).toEqual([
      ["add two service pages", ["B1"], "potential_addition"],
      ["a second round of revisions", ["B2"], "potential_addition"],
    ]);
    expect(res).toMatchObject({ needsJudgment: false, modelId: RULES_MODEL_ID, missingInformation: [] });
    const [row] = await db.admin<Record<string, unknown>>("select status, model_id, attempts from public.analysis_runs");
    expect(row).toEqual({ status: "success", model_id: RULES_MODEL_ID, attempts: 1 });
  });

  it("does not let visitor B analyse visitor A's project", async () => {
    const a = ownerRepository(pgliteRpc(db), await db.newVisitor());
    const b = ownerRepository(pgliteRpc(db), await db.newVisitor());
    const projectA = await startDemo(a);
    const create = vi.fn<CreateMessage>(async () => message(GOOD));
    await expect(analyseRequest(b, projectA, NORTHLIGHT_REQUEST, { create, modelId: "m" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(create).not.toHaveBeenCalled();
  });
});
