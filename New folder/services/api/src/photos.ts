import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { authOf } from "./auth.ts";
import { ApiError, badRequest, dbError } from "./errors.ts";

const MAX_PHOTOS = 5;

/** Identify the real image type from magic bytes; the client-declared MIME is never trusted. */
export function sniffImage(buf: Buffer): { ext: "jpg" | "png" | "webp"; mime: string } | null {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { ext: "png", mime: "image/png" };
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP")
    return { ext: "webp", mime: "image/webp" };
  return null;
}

type Target = {
  bucket: "listing-media" | "rental-media";
  table: "listing_photos" | "rental_photos";
  parentColumn: "listing_id" | "rental_id";
  parentId: string;
};

/**
 * Mirrors the web upload flow: pick a free slot (1-5), upload under
 * `<parent>/<uuid>.<ext>` as the user (Storage RLS applies), register the row,
 * and remove the object again if registration fails so no orphan is left.
 */
export async function attachPhoto(req: FastifyRequest, t: Target) {
  const { client } = authOf(req);
  if (!req.isMultipart()) throw badRequest("Send the image as multipart/form-data with a single file field.");
  const part = await req.file();
  if (!part) throw badRequest("No file was uploaded.");
  const bytes = await part.toBuffer();
  const kind = sniffImage(bytes);
  if (!kind) throw new ApiError(415, "unsupported_media_type", "Only JPEG, PNG or WebP images are accepted.");

  const { data: existing, error: findError } = await client.from(t.table).select("position").eq(t.parentColumn, t.parentId);
  if (findError) throw dbError(findError, "Could not check photo slots.");
  const used = new Set((existing ?? []).map((r: { position: number }) => Number(r.position)));
  const position = Array.from({ length: MAX_PHOTOS }, (_, i) => i + 1).find((n) => !used.has(n));
  if (!position) throw new ApiError(409, "photo_limit", "This item already has five photos.");

  const path = t.parentId + "/" + randomUUID() + "." + kind.ext;
  const up = await client.storage.from(t.bucket).upload(path, bytes, { contentType: kind.mime, upsert: false, cacheControl: "3600" });
  if (up.error) throw new ApiError(422, "upload_rejected", "The image was rejected. Check the file and your permissions.");

  const { error } = await client.from(t.table).insert({ [t.parentColumn]: t.parentId, storage_path: path, position });
  if (error) {
    await client.storage.from(t.bucket).remove([path]);
    throw dbError(error, "The image could not be attached. Retry.", 409);
  }
  return { position, content_type: kind.mime, bytes: bytes.length };
}
