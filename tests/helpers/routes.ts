import type { OwnerRepository, ReviewRepository } from "@/lib/db/repository";

/**
 * TEST FIXTURE. Route handlers obtain repositories from @/lib/auth/session and
 * @/lib/db/admin; tests swap those modules (vi.mock) for PGlite-backed ones so
 * the real handlers, validation, error mapping and SQL routines all run.
 */
export const current: { owner: OwnerRepository | null; review: ReviewRepository | null } = { owner: null, review: null };

export const ORIGIN = "http://localhost:3000";

export function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, host: "localhost:3000", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export function get(path: string): Request {
  return new Request(`${ORIGIN}${path}`, { headers: { host: "localhost:3000" } });
}

export const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
