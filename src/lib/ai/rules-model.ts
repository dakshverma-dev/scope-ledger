import type Anthropic from "@anthropic-ai/sdk";
import type { BaselineItem } from "@/lib/domain/types";
import type { CreateMessage } from "./extract";
import { AI_LIMITS, TOOL_NAME, type Extraction } from "./schema";

/**
 * Built-in deterministic extractor used when no hosted model is configured.
 * It answers in the same extract_scope_changes tool format, so its output goes
 * through exactly the same validation as a hosted model's.
 */
export const RULES_MODEL_ID = "scope-ledger-rules-1";

const STOPWORDS = new Set(
  "a an the of and or to for by on in at with we i you it is be our your this that please could would can will also just some one two three four five six seven eight nine ten agreed include including".split(" "),
);
const SYNONYMS: string[][] = [
  ["page", "website", "site", "screen", "landing"],
  ["revision", "round", "amend", "change", "feedback", "edit"],
  ["deliver", "deadline", "date", "due", "launch", "handover"],
  ["design", "layout", "mockup", "style"],
  ["implement", "build", "develop", "code"],
];
const ADDITION = /\b(add|adding|extra|another|additional|more|new|second|third|further|also|plus|expand|extend)\b/i;
const CLARIFY = /\b(clarify|confirm|does|do|is|are|what|which|mean|meant|included|cover)\b/i;
const UNCERTAIN = /\b(maybe|might|perhaps|possibly|not sure|unsure|could we|consider|think about)\b|\?/i;
const LEADING_FILLER = /^(?:\s|please|kindly|could you|can you|would you|we(?:'d| would) like(?: you)? to|i(?:'d| would) like(?: you)? to|we need(?: you)? to|and|also|then|plus|as well as|,)+/i;

function stem(word: string): string {
  const w = word.toLowerCase();
  return w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
}

/** Content words mapped to a canonical concept, in order (duplicates kept). */
function concepts(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const w = stem(raw);
    if (STOPWORDS.has(w) || w.length < 3) continue;
    const group = SYNONYMS.find((g) => g.includes(w));
    out.push(group ? group[0] : w);
  }
  return out;
}

/** Splits the request into clause spans, keeping exact offsets so quotes stay literal. */
function clauses(text: string): string[] {
  const out: string[] = [];
  const boundary = /[.!?;\n]+|,\s*(?:and\s+)?|\s+and\s+|\s+as well as\s+|\s+plus\s+/gi;
  let start = 0;
  for (const m of text.matchAll(boundary)) {
    out.push(text.slice(start, m.index));
    start = (m.index ?? 0) + m[0].length;
  }
  out.push(text.slice(start));
  return out
    .map((c) => c.replace(LEADING_FILLER, "").trim().replace(/[\s,.;:!]+$/, ""))
    .filter((c) => (c.match(/[A-Za-z]+/g) ?? []).length >= 3);
}

function bestBaselineIds(clause: string, baseline: BaselineItem[]): string[] {
  const words = new Set(concepts(clause));
  // Count every baseline word that matches, so "page … website" outweighs a single "pages".
  const scored = baseline.map((b) => ({ id: b.id, score: concepts(b.text).filter((w) => words.has(w)).length }));
  const top = Math.max(0, ...scored.map((s) => s.score));
  return top === 0 ? [] : scored.filter((s) => s.score === top).map((s) => s.id).slice(0, 2);
}

export function analyseByRules(baseline: BaselineItem[], requestText: string): Extraction {
  const items: Extraction["items"] = [];
  const missingInformation: string[] = [];
  const textOf = new Map(baseline.map((b) => [b.id, b.text]));

  for (const clause of clauses(requestText).slice(0, AI_LIMITS.items)) {
    const quote = clause.slice(0, AI_LIMITS.quote);
    const ids = bestBaselineIds(clause, baseline);
    let classification: Extraction["items"][number]["classification"];
    if (UNCERTAIN.test(clause) || ids.length === 0) classification = "unclear";
    else if (ADDITION.test(clause)) classification = "potential_addition";
    else if (CLARIFY.test(clause)) classification = "clarification";
    else classification = "unclear";

    const refs = ids.map((id) => `${id} ("${textOf.get(id)}")`).join(" and ");
    const reason =
      classification === "potential_addition"
        ? `Asks for more than ${refs} states.`
        : classification === "clarification"
          ? `Asks about the scope of ${refs}.`
          : ids.length === 0
            ? "No agreed deliverable clearly covers this request."
            : `The texts do not settle whether this changes ${refs}.`;
    if (classification === "unclear") {
      missingInformation.push(`Is "${quote.slice(0, 120)}" part of the agreed work or an addition?`);
    }
    items.push({
      requestedChange: (quote.charAt(0).toUpperCase() + quote.slice(1)).slice(0, AI_LIMITS.change),
      sourceQuote: quote,
      baselineItemIds: ids,
      classification,
      reason: reason.slice(0, AI_LIMITS.reason),
    });
  }
  if (items.length === 0) missingInformation.push("No concrete change was found in the request.");
  return { items, missingInformation: missingInformation.slice(0, AI_LIMITS.missing) };
}

/** Adapts the extractor to the model-call interface used by extractScopeChanges. */
export function rulesCreateMessage(baseline: BaselineItem[], requestText: string): CreateMessage {
  return async () => {
    const input = analyseByRules(baseline, requestText);
    return {
      id: `rules_${Date.now().toString(36)}`,
      type: "message",
      role: "assistant",
      model: RULES_MODEL_ID,
      stop_reason: "tool_use",
      stop_sequence: null,
      content: [{ type: "tool_use", id: "rules_tool_use", name: TOOL_NAME, input }],
      usage: { input_tokens: 0, output_tokens: 0 },
    } as unknown as Anthropic.Message;
  };
}
