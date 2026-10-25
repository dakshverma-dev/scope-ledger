import "server-only";
import { cookies } from "next/headers";
import { serviceRpc } from "@/lib/db/admin";
import type { OwnerRepository } from "@/lib/db/repository";
import { ownerRepository, resolveVisitor } from "@/lib/db/rpc-repository";
import { generateReviewToken, hashToken } from "@/lib/domain/tokens";
import { reviewTokenSchema } from "@/lib/domain/validation";
import { AppError } from "@/lib/http/errors";

/**
 * Account-free workspaces: each browser gets a random 32-byte secret in an
 * HttpOnly cookie. Only its SHA-256 is stored; the database maps it to a
 * visitor ID that every owner routine checks.
 */
const COOKIE = "sl_visitor";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

async function cookieSecret(): Promise<string | null> {
  const value = (await cookies()).get(COOKIE)?.value;
  return value && reviewTokenSchema.safeParse(value).success ? value : null;
}

/** The current browser's workspace, or null if it has none yet. */
export async function getOwnerRepository(): Promise<OwnerRepository | null> {
  const secret = await cookieSecret();
  if (!secret) return null;
  const rpc = serviceRpc();
  const visitorId = await resolveVisitor(rpc, hashToken(secret), false);
  return visitorId ? ownerRepository(rpc, visitorId) : null;
}

export async function requireOwnerRepository(): Promise<OwnerRepository> {
  const repo = await getOwnerRepository();
  if (!repo) throw new AppError("UNAUTHENTICATED");
  return repo;
}

/** Resumes this browser's workspace or creates one (Try the demo). Route handlers only. */
export async function ensureVisitor(): Promise<OwnerRepository> {
  const store = await cookies();
  const rpc = serviceRpc();
  const existing = await cookieSecret();
  const secret = existing ?? generateReviewToken();
  const visitorId = await resolveVisitor(rpc, hashToken(secret), true);
  if (!visitorId) throw new AppError("INTERNAL");
  if (!existing) {
    store.set(COOKIE, secret, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE_SECONDS,
    });
  }
  return ownerRepository(rpc, visitorId);
}
