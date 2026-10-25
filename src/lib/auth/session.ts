import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabaseOwnerRepository } from "@/lib/db/supabase-repository";
import type { OwnerRepository } from "@/lib/db/repository";
import { supabaseConfig } from "@/lib/env";
import { AppError } from "@/lib/http/errors";

/**
 * One cookie-backed Supabase client per request, using the publishable key and
 * the visitor's own session. Anonymous sign-in happens server-side, so the
 * browser bundle contains no Supabase client or key at all.
 */
export async function createSessionClient(): Promise<SupabaseClient> {
  const { url, publishableKey } = supabaseConfig();
  const store = await cookies();
  return createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only; proxy.ts refreshes them.
        }
      },
    },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
}

/** Verifies the session with Supabase Auth (not just the cookie) and returns the visitor. */
export async function getOwnerRepository(): Promise<OwnerRepository | null> {
  const client = await createSessionClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return supabaseOwnerRepository(client, data.user.id);
}

export async function requireOwnerRepository(): Promise<OwnerRepository> {
  const repo = await getOwnerRepository();
  if (!repo) throw new AppError("UNAUTHENTICATED");
  return repo;
}

/** Resumes the visitor's anonymous identity, or creates one (Try the demo). */
export async function ensureAnonymousVisitor(): Promise<OwnerRepository> {
  const existing = await getOwnerRepository();
  if (existing) return existing;
  const client = await createSessionClient();
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user) {
    throw new AppError("SERVICE_NOT_CONFIGURED", "Could not start an anonymous demo session. Check that anonymous sign-ins are enabled.");
  }
  return supabaseOwnerRepository(client, data.user.id);
}
