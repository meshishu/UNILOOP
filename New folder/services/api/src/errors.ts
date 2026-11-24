import type { ZodError } from "zod";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, "bad_request", message, details);
export const unauthorized = (message = "Sign in required.") => new ApiError(401, "unauthorized", message);
export const forbidden = (message = "Not allowed.") => new ApiError(403, "forbidden", message);
export const notFound = (message = "Not found.") => new ApiError(404, "not_found", message);

type DbError = { code?: string; message?: string } | null | undefined;

/**
 * Translate a PostgREST/Postgres error into a safe API error. Raw database
 * messages can contain private detail, so only fixed text is ever returned.
 * `fallbackStatus` is used for business-rule violations raised by RPCs.
 */
export function dbError(error: DbError, fallback: string, fallbackStatus = 409): ApiError {
  const code = error?.code ?? "";
  if (code === "PT429")
    return new ApiError(429, "rate_limited", "You have reached the limit for this action. Try again later.");
  if (code === "PGRST301" || code === "PGRST303") return unauthorized("Session expired.");
  if (code === "PGRST116") return notFound();
  if (code === "42501") return forbidden("Not permitted for this account.");
  if (code === "23505") return new ApiError(409, "conflict", "This already exists.");
  if (code === "23P01") return new ApiError(409, "conflict", "That period is already taken.");
  if (code === "22P02" || code === "22007" || code === "22008") return badRequest("Invalid value.");
  if (code.startsWith("23")) return new ApiError(422, "constraint_violation", fallback);
  return new ApiError(fallbackStatus, fallbackStatus === 422 ? "unprocessable" : "conflict", fallback);
}

export function zodDetails(error: ZodError) {
  return error.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message }));
}
