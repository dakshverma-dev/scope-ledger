import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serviceRoleKey, supabaseConfig } from "@/lib/env";
import { reviewRepository as reviewRepositoryFrom, type Rpc } from "./rpc-repository";
import type { ReviewRepository } from "./repository";

/**
 * Server-only database access with the service-role key. It is used only to
 * call the app's SECURITY DEFINER routines, each of which checks the visitor
 * or review-token hash it is given; nothing reads tables directly.
 */
export function serviceRpc(): Rpc {
  const { url } = supabaseConfig();
  const client = createClient(url, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
  return async (fn, args) => {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw error;
    return data;
  };
}

export function reviewRepository(): ReviewRepository {
  return reviewRepositoryFrom(serviceRpc());
}
