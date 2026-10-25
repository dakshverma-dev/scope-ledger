import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..");

export type Role = "anon" | "authenticated" | "service_role";

export interface TestDb {
  pg: PGlite;
  /** Creates an auth.users row, as Supabase does for each anonymous sign-in. */
  newVisitor(): Promise<string>;
  /** Runs one statement in its own transaction as `role`, with JWT claims for `uid`. */
  run<T = Record<string, unknown>>(role: Role, uid: string | null, sql: string, params?: unknown[]): Promise<T[]>;
  asUser<T = Record<string, unknown>>(uid: string, sql: string, params?: unknown[]): Promise<T[]>;
  asService<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Superuser access for test setup only (e.g. ageing a token). */
  admin<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export function migrationSql(): string {
  const dir = path.join(root, "supabase", "migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(path.join(dir, f), "utf8"))
    .join("\n");
}

export async function createTestDb(): Promise<TestDb> {
  const pg = new PGlite();
  await pg.exec(readFileSync(path.join(root, "tests", "fixtures", "supabase-shim.sql"), "utf8"));
  await pg.exec(migrationSql());

  const run: TestDb["run"] = async (role, uid, sql, params = []) => {
    return pg.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [
        uid ? JSON.stringify({ sub: uid, role }) : "",
      ]);
      await tx.exec(`set local role ${role}`);
      const res = await tx.query(sql, params);
      return res.rows as never;
    });
  };

  return {
    pg,
    async newVisitor() {
      const id = randomUUID();
      await pg.query("insert into auth.users (id) values ($1)", [id]);
      return id;
    },
    run,
    asUser: (uid, sql, params) => run("authenticated", uid, sql, params),
    asService: (sql, params) => run("service_role", null, sql, params),
    admin: async (sql, params = []) => (await pg.query(sql, params)).rows as never,
  };
}

/** Hex SHA-256 of a string, matching src/lib/domain/tokens. */
export async function sha256Hex(value: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(value).digest("hex");
}
