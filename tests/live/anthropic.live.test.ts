import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { anthropicCreateMessage, extractScopeChanges } from "@/lib/ai/extract";

/**
 * LIVE CHECK: one real extraction of the Northlight fixture with MODEL_ID.
 * Run with `npm run test:live`. Prints the actual model ID and token usage for
 * docs/acceptance.md. Costs one (or two, if a repair is needed) API calls.
 */
const apiKey = process.env.ANTHROPIC_API_KEY;
const modelId = process.env.MODEL_ID ?? "claude-haiku-5-5";

describe.skipIf(!apiKey)("live Anthropic: model availability and Northlight extraction", () => {
  it("the configured model is available to this key", async () => {
    const model = await new Anthropic({ apiKey }).models.retrieve(modelId);
    console.log("Model available:", model.id, model.display_name);
    expect(model.id).toBe(modelId);
  });

  it("extracts two grounded Northlight changes", async () => {
    const out = await extractScopeChanges({
      create: anthropicCreateMessage(apiKey!),
      modelId,
      baseline: [
        { id: "B1", text: "Design and implement a three page responsive website" },
        { id: "B2", text: "Include one round of revisions" },
        { id: "B3", text: "Deliver the agreed pages by 2026-11-09" },
      ],
      requestText: "Please add two service pages and a second round of revisions.",
    });
    console.log("Live extraction:", JSON.stringify({ ok: out.ok, modelId: out.modelId, usage: out.usage, attempts: out.attempts, ...(out.ok ? { items: out.value.items } : { code: out.code }) }, null, 2));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.items.length).toBeGreaterThanOrEqual(2);
    const ids = out.value.items.flatMap((i) => i.baselineItemIds);
    expect(ids).toContain("B1");
    expect(ids).toContain("B2");
  }, 40_000);
});
