import { z } from "zod";

const bool = z.enum(["true", "false"]).default("false").transform((v) => v === "true");
const int = (def: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(def);

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  PORT: int(4000, 1, 65535),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.string().default("production"),
  CORS_ORIGINS: z.string().default(""),
  TRUST_PROXY_HOPS: int(0, 0, 10),
  RATE_LIMIT_PER_MINUTE: int(120, 1, 100000),
  AUTH_RATE_LIMIT_PER_MINUTE: int(10, 1, 1000),
  ENABLE_MARKETPLACE_WRITES: bool,
  ENABLE_MARKETPLACE_INTERACTIONS: bool,
  ENABLE_MARKETPLACE_USER_ACTIONS: bool,
  ENABLE_RENTAL_OPERATIONS: bool,
  ENABLE_SALE_TRANSACTIONS: bool,
});

export type Gate = "writes" | "interactions" | "userActions" | "rentals" | "sales";

export type Config = {
  supabaseUrl: string;
  supabaseKey: string;
  port: number;
  host: string;
  isProduction: boolean;
  corsOrigins: string[];
  trustProxyHops: number;
  rateLimit: number;
  authRateLimit: number;
  gates: Record<Gate, boolean>;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error("Invalid configuration: " + names);
  }
  const e = parsed.data;
  // A service-role key in a service that must run under user RLS is a mistake.
  if (looksLikeServiceRole(e.SUPABASE_PUBLISHABLE_KEY)) {
    throw new Error("SUPABASE_PUBLISHABLE_KEY looks like a service_role/secret key; refusing to start.");
  }
  return {
    supabaseUrl: e.SUPABASE_URL.replace(/\/+$/, ""),
    supabaseKey: e.SUPABASE_PUBLISHABLE_KEY,
    port: e.PORT,
    host: e.HOST,
    isProduction: e.NODE_ENV === "production",
    corsOrigins: e.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    trustProxyHops: e.TRUST_PROXY_HOPS,
    rateLimit: e.RATE_LIMIT_PER_MINUTE,
    authRateLimit: e.AUTH_RATE_LIMIT_PER_MINUTE,
    gates: {
      writes: e.ENABLE_MARKETPLACE_WRITES,
      interactions: e.ENABLE_MARKETPLACE_INTERACTIONS,
      userActions: e.ENABLE_MARKETPLACE_USER_ACTIONS,
      rentals: e.ENABLE_RENTAL_OPERATIONS,
      sales: e.ENABLE_SALE_TRANSACTIONS,
    },
  };
}

function looksLikeServiceRole(key: string): boolean {
  if (key.startsWith("sb_secret_")) return true;
  const part = key.split(".")[1];
  if (!part) return false;
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}
