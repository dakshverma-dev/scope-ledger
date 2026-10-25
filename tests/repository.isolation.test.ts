import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { fromDbError } from "@/lib/db/errors";
import { assertSameOrigin } from "@/lib/http/origin";
import { AppError } from "@/lib/http/errors";
import { publishChange } from "@/lib/services/publish";
import { getProjectOverview, getVersionDetail, startDemo } from "@/lib/services/workspace";
import { createTestDb, type TestDb } from "./helpers/db";
import { pgliteOwnerRepository } from "./helpers/pglite-repo";
import { NORTHLIGHT_PUBLISH } from "./helpers/fixtures";

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});

const visitor = async () => pgliteOwnerRepository(db, await db.newVisitor());

describe("visitor isolation through the repository used by routes", () => {
  it("visitor B gets NOT_FOUND for every one of visitor A's records", async () => {
    const a = await visitor();
    const b = await visitor();
    const projectA = await startDemo(a);
    await startDemo(b);
    const v1 = await publishChange(a, projectA, NORTHLIGHT_PUBLISH());

    expect((await b.listProjects()).map((p) => p.id)).not.toContain(projectA);
    expect(await b.getProject(projectA)).toBeNull();
    expect(await b.getVersion(v1.versionId)).toBeNull();
    expect(await b.listDecisions([v1.versionId])).toEqual([]);
    expect(await b.getActiveLink(projectA)).toBeNull();
    await expect(getProjectOverview(b, projectA)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(getVersionDetail(b, v1.versionId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(publishChange(b, projectA, NORTHLIGHT_PUBLISH())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(b.beginAnalysisRun(projectA, "0".repeat(64))).rejects.toMatchObject({ code: "NOT_FOUND" });

    const overview = await getProjectOverview(a, projectA);
    expect(overview.current?.status).toBe("awaiting_decision");
    expect(overview.activeLink?.changeVersionId).toBe(v1.versionId);
  });

  it("malformed IDs are indistinguishable from missing ones", async () => {
    const a = await visitor();
    await expect(getProjectOverview(a, "not-a-uuid")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getProjectOverview(a, randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getVersionDetail(a, "1 or 1=1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("maps the free allowance to 429 FREE_LIMIT_REACHED", async () => {
    const a = await visitor();
    await startDemo(a);
    await expect(
      a.createProject({
        name: "Other",
        clientName: "Client",
        baselineItems: [{ id: "B1", text: "x" }],
        originalFeePence: 1,
        ratePence: 1,
        dueOn: "2026-12-01",
      }),
    ).rejects.toMatchObject({ code: "FREE_LIMIT_REACHED", status: 429 });
  });
});

describe("error contract", () => {
  it("maps routine codes and SQLSTATEs without leaking details", () => {
    expect(fromDbError({ message: "STALE_VERSION" })).toMatchObject({ code: "STALE_VERSION", status: 409 });
    expect(fromDbError({ message: "DECISION_CONFLICT" })).toMatchObject({ status: 409 });
    expect(fromDbError({ message: "RATE_LIMITED_DAY" })).toMatchObject({ code: "RATE_LIMITED", status: 429 });
    expect(fromDbError({ message: "INVALID_EFFORT" })).toMatchObject({ code: "VALIDATION_FAILED", status: 422 });
    expect(fromDbError({ code: "23514", message: 'new row violates check constraint "x"' })).toMatchObject({ status: 422 });
    const internal = fromDbError({ code: "08006", message: "connection to 10.0.0.1 failed" });
    expect(internal).toMatchObject({ code: "INTERNAL", status: 500 });
    expect(internal.message).not.toContain("10.0.0.1");
  });
});

describe("same-origin check", () => {
  const req = (headers: Record<string, string>) =>
    new Request("http://localhost:3000/api/review/x/decision", { method: "POST", headers });

  it("accepts the app's own origin", () => {
    expect(() => assertSameOrigin(req({ origin: "https://app.example", host: "app.example", "x-forwarded-proto": "https" }), undefined)).not.toThrow();
    expect(() => assertSameOrigin(req({ origin: "https://scope.example" }), "https://scope.example")).not.toThrow();
    expect(() => assertSameOrigin(req({ "sec-fetch-site": "same-origin" }), undefined)).not.toThrow();
  });

  it("rejects cross-site and origin-less requests", () => {
    const attempt = (h: Record<string, string>) => {
      try {
        assertSameOrigin(req(h), "https://scope.example");
        return null;
      } catch (e) {
        return e as AppError;
      }
    };
    expect(attempt({ origin: "https://evil.example", host: "localhost:3000" })).toMatchObject({ code: "FORBIDDEN_ORIGIN", status: 403 });
    expect(attempt({})).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
    expect(attempt({ "sec-fetch-site": "cross-site" })).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
  });
});
