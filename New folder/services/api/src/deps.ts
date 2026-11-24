import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Config } from "./config.ts";

export type Deps = {
  /** Unauthenticated client (publishable key) for Auth flows. */
  anon(): SupabaseClient;
  /** Client that carries the caller's JWT, so PostgREST/Storage apply RLS as that user. */
  user(accessToken: string): SupabaseClient;
  /** Revoke the caller's session server-side. */
  signOut(accessToken: string): Promise<boolean>;
  /** Liveness of the upstream Supabase Auth service. */
  ping(): Promise<boolean>;
};

const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

export function createDeps(config: Config): Deps {
  return {
    anon: () => createClient(config.supabaseUrl, config.supabaseKey, { auth: noSession }),
    user: (token) =>
      createClient(config.supabaseUrl, config.supabaseKey, {
        auth: noSession,
        global: { headers: { Authorization: "Bearer " + token } },
      }),
    async signOut(token) {
      try {
        const res = await fetch(config.supabaseUrl + "/auth/v1/logout?scope=local", {
          method: "POST",
          headers: { apikey: config.supabaseKey, Authorization: "Bearer " + token },
          signal: AbortSignal.timeout(5000),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    async ping() {
      try {
        const res = await fetch(config.supabaseUrl + "/auth/v1/health", {
          headers: { apikey: config.supabaseKey },
          signal: AbortSignal.timeout(2500),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
