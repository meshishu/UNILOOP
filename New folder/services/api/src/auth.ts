import type { FastifyReply, FastifyRequest } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { UUID_RE } from "./common.ts";
import { ApiError, forbidden, unauthorized } from "./errors.ts";

export type AuthContext = {
  token: string;
  userId: string;
  email: string;
  client: SupabaseClient;
};
export type Campus = { id: string; name: string };

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
    campusCache?: { campuses: Campus[]; active: Campus };
  }
}

/**
 * Verifies the bearer token against Supabase Auth on every request (so revoked
 * sessions stop working immediately), requires a confirmed email, and attaches
 * a user-scoped client. A valid session still does NOT grant marketplace access:
 * RLS and campus membership decide that.
 */
export async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization ?? "";
  const match = /^Bearer ([A-Za-z0-9._~+/=-]{20,4096})$/.exec(header);
  if (!match) throw unauthorized();
  const token = match[1]!;
  const { data, error } = await req.server.deps.anon().auth.getUser(token);
  if (error || !data.user) throw unauthorized("Invalid or expired session.");
  if (!data.user.email_confirmed_at) throw new ApiError(403, "email_unconfirmed", "Confirm your email first.");
  req.auth = {
    token,
    userId: data.user.id,
    email: data.user.email ?? "",
    client: req.server.deps.user(token),
  };
}

export function authOf(req: FastifyRequest): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

/**
 * Campuses the caller may see (RLS-filtered). The active one is `X-Campus-Id`
 * when it is in that set, otherwise the first - the same rule as the web app.
 * The header grants nothing; it only selects among rows RLS already allowed.
 */
export async function campusOf(req: FastifyRequest) {
  if (req.campusCache) return req.campusCache;
  const { client } = authOf(req);
  const { data, error } = await client.from("campuses").select("id,name").order("id");
  if (error) throw new ApiError(502, "upstream_error", "Could not load campus access.");
  const campuses = (data ?? []) as Campus[];
  const asked = req.headers["x-campus-id"];
  const wanted = typeof asked === "string" && UUID_RE.test(asked) ? asked : undefined;
  const active = campuses.find((c) => c.id === wanted) ?? campuses[0];
  if (!active) throw forbidden("No approved campus membership for this account.");
  req.campusCache = { campuses, active };
  return req.campusCache;
}
