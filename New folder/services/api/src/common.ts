import { z, type ZodTypeAny } from "zod";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Gate } from "./config.ts";
import { ApiError, badRequest, zodDetails } from "./errors.ts";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const uuid = z.string().regex(UUID_RE, "Invalid id");
export const idParams = z.object({ id: uuid });

export function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) throw badRequest("Invalid request.", zodDetails(result.error));
  return result.data;
}

/** Same bounds as the web app: page 1..1000, size 1..50. One extra row detects "next page". */
export function pageWindow(query: unknown, defaultSize = 24) {
  const q = parse(
    z.object({
      page: z.coerce.number().int().min(1).max(1000).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(defaultSize),
    }),
    query,
  );
  return { page: q.page, limit: q.limit, from: (q.page - 1) * q.limit, to: q.page * q.limit };
}
export type Window = ReturnType<typeof pageWindow>;

export function paged<T>(rows: T[] | null | undefined, w: Window) {
  const list = rows ?? [];
  return {
    data: list.slice(0, w.limit),
    page: { page: w.page, limit: w.limit, hasMore: list.length > w.limit },
  };
}

/** Feature gates mirror apps/web. They are UX switches; RLS is the real boundary. */
export function gate(name: Gate) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    if (!req.server.config.gates[name]) {
      throw new ApiError(503, "feature_disabled", "This feature is not enabled yet.");
    }
  };
}

const SIGNED_URL_SECONDS = 120;

/** Batch-sign private Storage paths. Failed paths come back as null, never as an error. */
export async function signPaths(
  client: SupabaseClient,
  bucket: "listing-media" | "rental-media",
  paths: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!paths.length) return out;
  const { data, error } = await client.storage.from(bucket).createSignedUrls(paths, SIGNED_URL_SECONDS);
  for (const p of paths) out.set(p, null);
  if (error || !data) return out;
  for (const row of data) {
    if (row.path && row.signedUrl && !row.error) out.set(row.path, row.signedUrl);
  }
  return out;
}

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T00:00:00.000Z");
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Invalid calendar date");

export const condition = z.enum(["new", "like_new", "good", "fair"]);
export const categorySlug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(56);
// Idempotency key: clients generate a UUID per user intent and reuse it on retry.
export const nonce = uuid;
