import "server-only";
import { AppError } from "@/lib/http/errors";

/**
 * Server-side configuration. Values are read per call so a missing optional
 * service (e.g. Anthropic) degrades one feature instead of the whole app.
 * NEXT_PUBLIC_* names are part of the required contract, but no client
 * component reads them: every Supabase call runs on the server.
 */
function read(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export function supabaseConfig(): { url: string; publishableKey: string } {
  const url = read("NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = read("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (!url || !publishableKey) throw new AppError("SERVICE_NOT_CONFIGURED", "Supabase is not configured on this deployment.");
  return { url, publishableKey };
}

export function isSupabaseConfigured(): boolean {
  return Boolean(read("NEXT_PUBLIC_SUPABASE_URL") && read("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"));
}

export function serviceRoleKey(): string {
  const key = read("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new AppError("SERVICE_NOT_CONFIGURED", "Review links are not configured on this deployment.");
  return key;
}

export function anthropicConfig(): { apiKey: string; modelId: string } | null {
  const apiKey = read("ANTHROPIC_API_KEY");
  if (!apiKey) return null;
  return { apiKey, modelId: read("MODEL_ID") ?? "claude-haiku-5-5" };
}

/** Public origin used for review links and same-origin checks. */
export function appBaseUrl(): string | undefined {
  const v = read("APP_BASE_URL");
  return v ? v.replace(/\/+$/, "") : undefined;
}
