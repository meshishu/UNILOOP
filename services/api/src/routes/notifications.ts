import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { gate, pageWindow, paged, parse, uuid } from "../common.ts";
import { authOf, requireAuth } from "../auth.ts";
import { ApiError, dbError } from "../errors.ts";

const TARGETS: Record<string, string> = { inbox: "conversation", rentals: "booking", transactions: "transaction" };

/** link_path is a web route like /inbox/<uuid>; expose a client-neutral target as well. */
function target(link: string) {
  const m = /^\/(inbox|rentals|transactions)\/([0-9a-f-]{36})$/.exec(link);
  return m ? { type: TARGETS[m[1]!]!, id: m[2]! } : null;
}

export async function notificationRoutes(app: FastifyInstance) {
  app.get("/notifications", { preHandler: requireAuth }, async (req) => {
    const { client, userId } = authOf(req);
    const w = pageWindow(req.query);
    const [list, unread] = await Promise.all([
      client.from("notifications").select("id,category,title,link_path,created_at,read_at").eq("user_id", userId)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).range(w.from, w.to),
      client.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).is("read_at", null),
    ]);
    if (list.error) throw new ApiError(502, "upstream_error", "Could not load notifications.");
    const out = paged(list.data as { link_path: string }[], w);
    return {
      data: out.data.map((n) => ({ ...n, target: target(n.link_path) })),
      page: out.page,
      unread_count: unread.count ?? null,
    };
  });

  // Omit `id` to mark everything read.
  app.post("/notifications/read", { preHandler: [requireAuth, gate("userActions")] }, async (req) => {
    const { client, userId } = authOf(req);
    const body = parse(z.object({ id: uuid.optional() }), req.body);
    let q = client.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", userId).is("read_at", null);
    if (body.id) q = q.eq("id", body.id);
    const { error } = await q;
    if (error) throw dbError(error, "Could not mark as read.", 422);
    return { data: { ok: true } };
  });
}
