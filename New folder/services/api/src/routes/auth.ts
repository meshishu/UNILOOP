import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parse } from "../common.ts";
import { requireAuth, authOf } from "../auth.ts";
import { unauthorized } from "../errors.ts";

const email = z.string().trim().toLowerCase().email().max(254);

const sessionBody = (s: { access_token: string; refresh_token: string; expires_at?: number; expires_in?: number; user: { id: string; email?: string } }) => ({
  data: {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at ?? null,
    expires_in: s.expires_in ?? null,
    user: { id: s.user.id, email: s.user.email ?? null },
  },
});

export async function authRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: app.config.authRateLimit, timeWindow: "1 minute" } } };

  // Sends a one-time code / magic link. Always answers 202 so the endpoint
  // cannot be used to discover which emails have accounts.
  app.post("/auth/otp", strict, async (req, reply) => {
    const body = parse(z.object({ email, intent: z.enum(["signin", "signup"]).default("signin") }), req.body);
    const { error } = await app.deps.anon().auth.signInWithOtp({
      email: body.email,
      options: { shouldCreateUser: body.intent === "signup" },
    });
    if (error) req.log.warn({ status: error.status }, "otp request failed");
    return reply.status(202).send({ data: { sent: true } });
  });

  // Accepts the emailed 6-8 digit code, or the token_hash from a magic link.
  app.post("/auth/verify", strict, async (req) => {
    const body = parse(
      z.union([
        z.object({ email, token: z.string().regex(/^\d{6,8}$/) }),
        z.object({ token_hash: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/) }),
      ]),
      req.body,
    );
    const auth = app.deps.anon().auth;
    const { data, error } = "token_hash" in body
      ? await auth.verifyOtp({ token_hash: body.token_hash, type: "email" })
      : await auth.verifyOtp({ email: body.email, token: body.token, type: "email" });
    if (error || !data.session) throw unauthorized("That code is invalid or has expired.");
    return sessionBody(data.session);
  });

  app.post("/auth/refresh", strict, async (req) => {
    const body = parse(z.object({ refresh_token: z.string().min(10).max(512) }), req.body);
    const { data, error } = await app.deps.anon().auth.refreshSession({ refresh_token: body.refresh_token });
    if (error || !data.session) throw unauthorized("Session cannot be refreshed. Sign in again.");
    return sessionBody(data.session);
  });

  app.post("/auth/logout", { preHandler: requireAuth }, async (req, reply) => {
    await app.deps.signOut(authOf(req).token);
    return reply.status(204).send();
  });
}
