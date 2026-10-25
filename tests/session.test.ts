import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "./helpers/db";

// TEST FIXTURES: an in-memory cookie jar per "browser", and the service client
// replaced by the PGlite RPC adapter. src/lib/auth/session.ts runs unchanged.
const jar = { cookies: new Map<string, { value: string; options: Record<string, unknown> }>() };
const state: { db: TestDb | null } = { db: null };

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)!.value } : undefined),
    set: (name: string, value: string, options: Record<string, unknown>) => void jar.cookies.set(name, { value, options }),
  }),
}));
vi.mock("@/lib/db/admin", async () => {
  const { pgliteRpc } = await import("./helpers/db");
  return { serviceRpc: () => pgliteRpc(state.db!), reviewRepository: () => null };
});

const { ensureVisitor, getOwnerRepository, requireOwnerRepository } = await import("@/lib/auth/session");
const { startDemo } = await import("@/lib/services/workspace");

beforeEach(async () => {
  state.db = await createTestDb();
  jar.cookies = new Map();
});

describe("cookie-based visitor workspaces (no sign-in)", () => {
  it("creates a workspace on first use and resumes it from the cookie", async () => {
    expect(await getOwnerRepository()).toBeNull();
    await expect(requireOwnerRepository()).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });

    const repo = await ensureVisitor();
    const cookie = jar.cookies.get("sl_visitor")!;
    expect(cookie.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });

    const projectId = await startDemo(repo);
    const again = await getOwnerRepository();
    expect(again?.userId).toBe(repo.userId);
    expect((await ensureVisitor()).userId).toBe(repo.userId);
    expect((await again!.listProjects()).map((p) => p.id)).toEqual([projectId]);

    // Only the hash is stored.
    const rows = JSON.stringify(await state.db!.admin("select * from public.visitors"));
    expect(rows).not.toContain(cookie.value);
  });

  it("keeps two browsers apart and ignores forged or unknown cookies", async () => {
    const a = await ensureVisitor();
    const projectA = await startDemo(a);
    const cookieA = jar.cookies.get("sl_visitor")!.value;

    jar.cookies = new Map();
    const b = await ensureVisitor();
    expect(b.userId).not.toBe(a.userId);
    expect(await b.getProject(projectA)).toBeNull();

    jar.cookies = new Map([["sl_visitor", { value: "A".repeat(43), options: {} }]]);
    expect(await getOwnerRepository()).toBeNull();
    jar.cookies = new Map([["sl_visitor", { value: "not a token", options: {} }]]);
    expect(await getOwnerRepository()).toBeNull();
    jar.cookies = new Map([["sl_visitor", { value: a.userId, options: {} }]]);
    expect(await getOwnerRepository()).toBeNull();

    jar.cookies = new Map([["sl_visitor", { value: cookieA, options: {} }]]);
    expect((await getOwnerRepository())?.userId).toBe(a.userId);
  });
});
