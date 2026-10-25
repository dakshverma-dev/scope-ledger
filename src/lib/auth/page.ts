import "server-only";
import { notFound } from "next/navigation";
import { getOwnerRepository } from "@/lib/auth/session";
import type { OwnerRepository } from "@/lib/db/repository";
import { isSupabaseConfigured } from "@/lib/env";
import { AppError } from "@/lib/http/errors";

export type PageSession = { state: "unconfigured" } | { state: "signed_out" } | { state: "ok"; repo: OwnerRepository };

export async function pageSession(): Promise<PageSession> {
  if (!isSupabaseConfigured()) return { state: "unconfigured" };
  const repo = await getOwnerRepository();
  return repo ? { state: "ok", repo } : { state: "signed_out" };
}

/** Runs a loader, turning "not yours / not found" into the generic 404 page. */
export async function orNotFound<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
}
