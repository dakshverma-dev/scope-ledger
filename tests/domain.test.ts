import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearDraft, loadDraft, saveDraft, type Draft } from "@/lib/client/draft";
import { isLiteralQuote, normalizeWhitespace, segmentByQuotes } from "@/lib/domain/evidence";
import { extraFeePence, formatGBP, parsePoundsToPence, revisedTotalPence } from "@/lib/domain/money";
import { generateReviewToken, hashToken } from "@/lib/domain/tokens";
import { createProjectSchema, decisionSchema, publishSchema, reviewTokenSchema } from "@/lib/domain/validation";
import { NORTHLIGHT_PUBLISH, NORTHLIGHT_REQUEST } from "./helpers/fixtures";

describe("money", () => {
  it("prices the Northlight fixture exactly", () => {
    expect(extraFeePence(9000, 90)).toBe(13500);
    expect(revisedTotalPence(180000, 13500)).toBe(193500);
    expect(extraFeePence(9000, 120)).toBe(18000);
    expect(formatGBP(13500)).toBe("£135.00");
    expect(formatGBP(193500)).toBe("£1,935.00");
    expect(formatGBP(18000)).toBe("£180.00");
  });

  it("rounds half-up to the penny with integer arithmetic", () => {
    // 1p/hour * 15 min = 0.25p -> 0; 2p * 15 = 0.5p -> 1 (half up); 3p * 15 = 0.75p -> 1
    expect(extraFeePence(1, 15)).toBe(0);
    expect(extraFeePence(2, 15)).toBe(1);
    expect(extraFeePence(3, 15)).toBe(1);
    expect(extraFeePence(6, 15)).toBe(2); // 1.5p -> 2
    expect(extraFeePence(9999, 45)).toBe(7499); // 7499.25p -> 7499
    expect(extraFeePence(9998, 45)).toBe(7499); // 7498.5p -> 7499
    expect(extraFeePence(100000, 2400)).toBe(4000000);
  });

  it("refuses out-of-range inputs", () => {
    expect(() => extraFeePence(0, 15)).toThrow();
    expect(() => extraFeePence(100001, 15)).toThrow();
    expect(() => extraFeePence(100, 2401)).toThrow();
    expect(() => extraFeePence(100, 1.5)).toThrow();
  });

  it("parses typed pound amounts without floating point", () => {
    expect(parsePoundsToPence("1,800")).toBe(180000);
    expect(parsePoundsToPence("£90.00")).toBe(9000);
    expect(parsePoundsToPence("0.1")).toBe(10);
    expect(parsePoundsToPence("19.99")).toBe(1999);
    expect(parsePoundsToPence("1.234")).toBeNull();
    expect(parsePoundsToPence("-5")).toBeNull();
    expect(parsePoundsToPence("abc")).toBeNull();
  });
});

describe("publish validation", () => {
  it("accepts the fixture", () => {
    expect(publishSchema.safeParse(NORTHLIGHT_PUBLISH()).success).toBe(true);
  });

  it.each([-15, 0, 16, 17, 89, 2401, 2415, 90.5])("rejects effort %s", (effortMinutes) => {
    expect(publishSchema.safeParse(NORTHLIGHT_PUBLISH({ effortMinutes })).success).toBe(false);
  });

  it("rejects bad dates, keys, missing confirmation and item counts", () => {
    for (const revisedDueOn of ["2026-02-30", "2026-13-01", "11/11/2026", ""]) {
      expect(publishSchema.safeParse(NORTHLIGHT_PUBLISH({ revisedDueOn })).success).toBe(false);
    }
    expect(publishSchema.safeParse(NORTHLIGHT_PUBLISH({ publishKey: "not-a-uuid" })).success).toBe(false);
    expect(publishSchema.safeParse({ ...NORTHLIGHT_PUBLISH(), confirmed: false }).success).toBe(false);
    expect(publishSchema.safeParse(NORTHLIGHT_PUBLISH({ approvedItems: [] })).success).toBe(false);
    const item = NORTHLIGHT_PUBLISH().approvedItems[0];
    const eleven = Array.from({ length: 11 }, (_, i) => ({ ...item, id: `i${i}` }));
    expect(publishSchema.safeParse(NORTHLIGHT_PUBLISH({ approvedItems: eleven })).success).toBe(false);
    expect(publishSchema.safeParse(NORTHLIGHT_PUBLISH({ requestText: "x".repeat(5001) })).success).toBe(false);
    expect(publishSchema.safeParse(NORTHLIGHT_PUBLISH({ requestText: "   " })).success).toBe(false);
    const missing: Record<string, unknown> = { ...NORTHLIGHT_PUBLISH() };
    delete missing.effortMinutes;
    expect(publishSchema.safeParse(missing).success).toBe(false);
  });

  it("rejects injected money fields (price tampering)", () => {
    for (const extra of [{ extraFeePence: 1 }, { revisedTotalPence: 1 }, { ratePence: 1 }, { originalFeePence: 1 }]) {
      expect(publishSchema.safeParse({ ...NORTHLIGHT_PUBLISH(), ...extra }).success).toBe(false);
    }
    const item = { ...NORTHLIGHT_PUBLISH().approvedItems[0], feePence: 1 };
    expect(publishSchema.safeParse(NORTHLIGHT_PUBLISH({ approvedItems: [item] })).success).toBe(false);
  });

  it("keeps manually entered items free of model evidence", () => {
    const manual = { ...NORTHLIGHT_PUBLISH().approvedItems[0], origin: "manually_entered" as const };
    expect(publishSchema.safeParse(NORTHLIGHT_PUBLISH({ approvedItems: [manual] })).success).toBe(false);
    expect(
      publishSchema.safeParse(NORTHLIGHT_PUBLISH({ approvedItems: [{ ...manual, sourceQuote: null, classification: null }] })).success,
    ).toBe(true);
  });
});

describe("project and decision validation", () => {
  const base = {
    name: "P",
    clientName: "C",
    baselineItems: [{ id: "B1", text: "t" }],
    originalFeePence: 0,
    ratePence: 1,
    dueOn: "2026-11-09",
  };
  it("checks names, fees, rates and baseline", () => {
    expect(createProjectSchema.safeParse(base).success).toBe(true);
    expect(createProjectSchema.safeParse({ ...base, name: "" }).success).toBe(false);
    expect(createProjectSchema.safeParse({ ...base, clientName: "x".repeat(101) }).success).toBe(false);
    expect(createProjectSchema.safeParse({ ...base, originalFeePence: 100000001 }).success).toBe(false);
    expect(createProjectSchema.safeParse({ ...base, originalFeePence: 1.5 }).success).toBe(false);
    expect(createProjectSchema.safeParse({ ...base, ratePence: 0 }).success).toBe(false);
    expect(createProjectSchema.safeParse({ ...base, baselineItems: [] }).success).toBe(false);
    expect(createProjectSchema.safeParse({ ...base, baselineItems: [{ id: "", text: "t" }] }).success).toBe(false);
    expect(
      createProjectSchema.safeParse({ ...base, baselineItems: [{ id: "B1", text: "a" }, { id: "B1", text: "b" }] }).success,
    ).toBe(false);
  });

  it("checks reviewer input and strips injected fields", () => {
    expect(decisionSchema.parse({ decision: "accepted", declaredName: " Demo Client ", note: "  " })).toEqual({
      decision: "accepted",
      declaredName: "Demo Client",
      note: null,
    });
    expect(decisionSchema.safeParse({ decision: "approve", declaredName: "x" }).success).toBe(false);
    expect(decisionSchema.safeParse({ decision: "accepted", declaredName: "" }).success).toBe(false);
    expect(decisionSchema.safeParse({ decision: "accepted", declaredName: "x".repeat(101) }).success).toBe(false);
    expect(decisionSchema.safeParse({ decision: "accepted", declaredName: "x", note: "n".repeat(1001) }).success).toBe(false);
    expect(decisionSchema.safeParse({ decision: "accepted", declaredName: "x", extraFeePence: 0 }).success).toBe(false);
  });
});

describe("tokens", () => {
  it("issues 32-byte base64url tokens and stores only a SHA-256 hex hash", () => {
    const t = generateReviewToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(t, "base64url")).toHaveLength(32);
    expect(reviewTokenSchema.safeParse(t).success).toBe(true);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).not.toContain(t);
    expect(generateReviewToken()).not.toBe(t);
  });
});

describe("evidence", () => {
  it("accepts literal quotes after whitespace-only normalisation", () => {
    expect(isLiteralQuote(NORTHLIGHT_REQUEST, "add two service pages")).toBe(true);
    expect(isLiteralQuote("add  two\n service pages", "add two service pages")).toBe(true);
    expect(isLiteralQuote(NORTHLIGHT_REQUEST, "Add two service pages")).toBe(false); // case is not whitespace
    expect(isLiteralQuote(NORTHLIGHT_REQUEST, "add 2 service pages")).toBe(false);
    expect(isLiteralQuote(NORTHLIGHT_REQUEST, "   ")).toBe(false);
    expect(normalizeWhitespace("  a \t b ")).toBe("a b");
  });

  it("segments the request around quotes for highlighting", () => {
    const segs = segmentByQuotes(NORTHLIGHT_REQUEST, ["add two service pages", null, "a second round of revisions", "invented"]);
    expect(segs.filter((s) => s.mark !== null).map((s) => [s.text, s.mark])).toEqual([
      ["add two service pages", 0],
      ["a second round of revisions", 2],
    ]);
    expect(segs.map((s) => s.text).join("")).toBe(NORTHLIGHT_REQUEST);
  });
});

describe("local draft recovery", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    };
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  const draft: Draft = {
    v: 1,
    publishKey: "8f6d1c0e-2b0a-4a8e-9a4a-1f6c2a7d9b10",
    expectedCurrentVersionId: null,
    sourceVersionId: null,
    requestText: NORTHLIGHT_REQUEST,
    items: [],
    effortMinutes: "90",
    revisedDueOn: "2026-11-11",
    missingInformation: [],
    analysisRunId: null,
    updatedAt: "2026-10-25T00:00:00.000Z",
  };

  it("survives a reload with the same publish key, and is isolated per project", () => {
    saveDraft("p1", draft);
    expect(loadDraft("p1")).toEqual(draft);
    expect(loadDraft("p2")).toBeNull();
    clearDraft("p1");
    expect(loadDraft("p1")).toBeNull();
  });

  it("ignores corrupt storage instead of crashing", () => {
    store.set("scope-ledger:draft:p1", "{not json");
    expect(loadDraft("p1")).toBeNull();
  });
});
