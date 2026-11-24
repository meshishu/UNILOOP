import Fastify, { type FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import type { Config } from "./config.ts";
import type { Deps } from "./deps.ts";
import { ApiError, zodDetails } from "./errors.ts";
import { authRoutes } from "./routes/auth.ts";
import { meRoutes } from "./routes/me.ts";
import { listingRoutes } from "./routes/listings.ts";
import { rentalRoutes } from "./routes/rentals.ts";
import { conversationRoutes } from "./routes/conversations.ts";
import { transactionRoutes } from "./routes/transactions.ts";
import { notificationRoutes } from "./routes/notifications.ts";
import { adminRoutes } from "./routes/admin.ts";

declare module "fastify" {
  interface FastifyInstance {
    config: Config;
    deps: Deps;
  }
}

export async function buildApp(config: Config, deps: Deps, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : {
      level: config.isProduction ? "info" : "debug",
      // Tokens, cookies and OTPs must never reach logs.
      redact: ["req.headers.authorization", "req.headers.cookie", "req.body.token", "req.body.refresh_token"],
    },
    // proxy-addr (used by Fastify) accepts a hop count; Fastify's typings only list boolean/string.
    trustProxy: (config.trustProxyHops > 0 ? config.trustProxyHops : false) as unknown as boolean,
    bodyLimit: 64 * 1024,
    requestIdHeader: "x-request-id",
  });
  app.decorate("config", config);
  app.decorate("deps", deps);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.corsOrigins.length ? config.corsOrigins : false,
    allowedHeaders: ["authorization", "content-type", "x-campus-id", "x-request-id"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 600,
  });
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit,
    timeWindow: "1 minute",
    allowList: (req) => req.url === "/healthz",
    errorResponseBuilder: (_req, ctx) =>
      new ApiError(429, "rate_limited", "Too many requests. Retry in " + Math.ceil(ctx.ttl / 1000) + "s."),
  });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5, parts: 6 } });

  app.addHook("onSend", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: "bad_request", message: "Invalid request.", details: zodDetails(err) } });
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.code === "FST_REQ_FILE_TOO_LARGE") {
      return reply.status(413).send({ error: { code: "file_too_large", message: "Images are limited to 5 MB." } });
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: { code: e.code ?? "bad_request", message: e.statusCode === 429 ? "Too many requests." : "Bad request." } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.status(500).send({ error: { code: "internal", message: "Something went wrong." } });
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: { code: "not_found", message: "Route not found." } }),
  );

  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/readyz", async (_req, reply) => {
    const ok = await deps.ping();
    return reply.status(ok ? 200 : 503).send({ status: ok ? "ready" : "upstream_unavailable" });
  });

  await app.register(
    async (v1) => {
      await v1.register(authRoutes);
      await v1.register(meRoutes);
      await v1.register(listingRoutes);
      await v1.register(rentalRoutes);
      await v1.register(conversationRoutes);
      await v1.register(transactionRoutes);
      await v1.register(notificationRoutes);
      await v1.register(adminRoutes);
    },
    { prefix: "/v1" },
  );
  return app;
}
