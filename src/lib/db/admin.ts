import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serviceRoleKey, supabaseConfig } from "@/lib/env";
import { supabaseReviewRepository } from "./supabase-repository";
import type { ReviewRepository } from "./repository";

/**
 * Service-role access, used only by the review routes after the bearer token is
 * hashed. The service role may execute just the two token-checked routines; it
 * never reads tables directly here.
 */
export function reviewRepository(): ReviewRepository {
  const { url } = supabaseConfig();
  const admin = createClient(url, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
  return supabaseReviewRepository(admin);
}
